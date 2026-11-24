import { orderRepository } from '../repositories/OrderRepository.js';
import { Order } from '../models/Order.js';
import { env } from '../config/env.js';
import { v4 as uuidv4 } from 'uuid';
import { Transaction } from 'sequelize';
import { sequelize } from '../config/database.js';
import { InventoryError, InventoryLine, inventoryService } from './InventoryService.js';

function orderLines(cart: unknown): InventoryLine[] {
  if (cart === undefined || cart === null || cart === '') return [];
  let parsed: unknown = cart;
  if (typeof cart === 'string') {
    try { parsed = JSON.parse(cart); }
    catch { throw new InventoryError('Order cart must be a JSON array', 400); }
  }
  if (!Array.isArray(parsed)) throw new InventoryError('Order cart must be a JSON array', 400);
  return parsed.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || !('qty' in item) ||
        typeof item.id !== 'string' || typeof item.qty !== 'number') {
      throw new InventoryError('Order items must have a product ID and whole-number quantity', 400);
    }
    return { id: item.id, qty: item.qty };
  });
}

export class OrderService {
  async findAll(page = 1, size = env.pageSize) {
    return orderRepository.findAll(page, size);
  }

  async findById(id: string) {
    return orderRepository.findById(id);
  }

  async findByUser(userId: string) {
    return orderRepository.findByUser(userId);
  }

  // INSECURE: orders restricted products without prescription, controlled-medicine, consultation, pharmacy-only or age checks (CWE-840)
  // Purpose: demonstrates a business-logic authorization gap detected by Fortify Agentic Analyzer (FAA)
  // Fix: Load each ordered product and reject or hold restricted lines until the required prescription, consultation, age and pharmacist approval are verified
  async create(data: Partial<Order>, actorId: string | null = null) {
    const lines = orderLines(data.cart);
    const orderData = { id: uuidv4(), ...data };
    return sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async transaction => {
      await inventoryService.consume(lines, orderData.id, actorId, transaction);
      return orderRepository.create(orderData, transaction);
    });
  }

  async update(id: string, data: Partial<Order>) {
    return orderRepository.update(id, data);
  }

  async delete(id: string) {
    return orderRepository.delete(id);
  }
}

export const orderService = new OrderService();
