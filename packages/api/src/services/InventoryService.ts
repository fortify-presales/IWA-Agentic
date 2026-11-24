import { Op, Transaction } from 'sequelize';
import { sequelize } from '../config/database.js';
import { Product } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';

export class InventoryError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'InventoryError';
  }
}

export interface InventoryLine {
  id: string;
  qty: number;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export class InventoryService {
  async list() {
    return Product.findAll({ order: [['name', 'ASC']] });
  }

  async history(productId: string) {
    if (!await Product.findByPk(productId)) throw new InventoryError('Product not found', 404);
    return StockMovement.findAll({ where: { productId }, order: [['createdAt', 'DESC'], ['id', 'DESC']] });
  }

  async adjust(productId: string, stockLevel: unknown, lowStockThreshold: unknown, expectedStockLevel: unknown, userId: string) {
    if (!isNonNegativeInteger(stockLevel) || !isNonNegativeInteger(lowStockThreshold) ||
        !isNonNegativeInteger(expectedStockLevel)) {
      throw new InventoryError('Stock, expected stock and threshold must be non-negative whole numbers', 400);
    }

    return sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async transaction => {
      const product = await Product.findByPk(productId, { transaction });
      if (!product) throw new InventoryError('Product not found', 404);
      if (product.stockLevel !== expectedStockLevel) {
        throw new InventoryError('Stock changed since it was loaded; refresh and try again', 409);
      }
      return this.saveAdjustment(product, { stockLevel, lowStockThreshold }, userId, transaction);
    });
  }

  async updateProduct(productId: string, data: Partial<Product>, userId: string) {
    return sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async transaction => {
      const product = await Product.findByPk(productId, { transaction });
      if (!product) throw new InventoryError('Product not found', 404);
      if (data.id !== undefined && data.id !== productId) {
        throw new InventoryError('Product ID cannot be changed while updating inventory', 400);
      }
      const stockLevel = Object.hasOwn(data, 'stockLevel') ? data.stockLevel : product.stockLevel;
      const lowStockThreshold = Object.hasOwn(data, 'lowStockThreshold') ? data.lowStockThreshold : product.lowStockThreshold;
      if (!isNonNegativeInteger(stockLevel) || !isNonNegativeInteger(lowStockThreshold)) {
        throw new InventoryError('Stock and threshold must be non-negative whole numbers', 400);
      }
      if (data.inStock !== undefined && data.inStock !== (stockLevel > 0)) {
        throw new InventoryError('In-stock status must match the stock level', 400);
      }
      return this.saveAdjustment(product, { ...data, stockLevel, lowStockThreshold }, userId, transaction);
    });
  }

  private async saveAdjustment(
    product: Product,
    data: Partial<Product> & { stockLevel: number; lowStockThreshold: number },
    userId: string,
    transaction: Transaction,
  ) {
    const change = data.stockLevel - product.stockLevel;
    await product.update({ ...data, inStock: data.stockLevel > 0 }, { transaction });
    if (change !== 0) {
      await StockMovement.create({
        productId: product.id, type: 'adjustment', change, stockAfter: data.stockLevel, userId, orderId: null,
      }, { transaction });
    }
    return product;
  }

  async consume(lines: InventoryLine[], orderId: string, userId: string | null, transaction: Transaction) {
    const quantities = new Map<string, number>();
    for (const line of lines) {
      if (typeof line.id !== 'string' || !line.id || !Number.isSafeInteger(line.qty) || line.qty === 0) {
        throw new InventoryError('Order items must have a product ID and whole-number quantity', 400);
      }
      // INSECURE: negative order quantities remain accepted for the cart-tampering demo (CWE-472)
      // Purpose: preserves the existing negative-total demonstration without allowing stock increases
      // Fix: reject nonpositive order quantities before calculating totals or creating orders
      if (line.qty < 0) continue;
      const quantity = (quantities.get(line.id) ?? 0) + line.qty;
      if (!Number.isSafeInteger(quantity)) throw new InventoryError('Order quantity is too large', 400);
      quantities.set(line.id, quantity);
    }
    for (const [productId, quantity] of quantities) {
      const product = await Product.findByPk(productId, { transaction });
      if (!product) throw new InventoryError('Product not found', 404);
      if (product.stockLevel < quantity) {
        throw new InventoryError(`Insufficient stock for ${product.name}`, 409);
      }
      const stockLevel = product.stockLevel - quantity;
      const [updated] = await Product.update(
        { stockLevel, inStock: stockLevel > 0 },
        { where: { id: productId, stockLevel: { [Op.gte]: quantity } }, transaction },
      );
      if (updated !== 1) throw new InventoryError(`Insufficient stock for ${product.name}`, 409);
      await StockMovement.create({
        productId, type: 'checkout', change: -quantity, stockAfter: stockLevel, orderId, userId,
      }, { transaction });
    }
  }
}

export const inventoryService = new InventoryService();
