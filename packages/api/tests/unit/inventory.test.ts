import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('inventory management', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iwa-inventory-test-'));
  let sequelize: typeof import('../../src/config/database.js').sequelize;
  let Product: typeof import('../../src/models/Product.js').Product;
  let User: typeof import('../../src/models/User.js').User;
  let Order: typeof import('../../src/models/Order.js').Order;
  let StockMovement: typeof import('../../src/models/StockMovement.js').StockMovement;
  let inventoryService: typeof import('../../src/services/InventoryService.js').inventoryService;
  let orderService: typeof import('../../src/services/OrderService.js').orderService;
  let ensureInventorySchema: typeof import('../../src/config/inventorySchema.js').ensureInventorySchema;
  let app: express.Express;
  let userId: string;
  let apiUserId: string;
  let adminToken: string;
  let apiToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = path.join(directory, 'inventory.sqlite');
    ({ sequelize } = await import('../../src/config/database.js'));
    ({ Product } = await import('../../src/models/Product.js'));
    ({ User } = await import('../../src/models/User.js'));
    ({ Order } = await import('../../src/models/Order.js'));
    ({ StockMovement } = await import('../../src/models/StockMovement.js'));
    ({ inventoryService } = await import('../../src/services/InventoryService.js'));
    ({ orderService } = await import('../../src/services/OrderService.js'));
    ({ ensureInventorySchema } = await import('../../src/config/inventorySchema.js'));
    const { adminApiRouter } = await import('../../src/api/v3/admin.js');
    const { productsRouter } = await import('../../src/api/v3/products.js');
    const { ordersRouter } = await import('../../src/api/v3/orders.js');
    const { cartRouter } = await import('../../src/web/cart.js');
    const { configurePassport } = await import('../../src/config/passport.js');
    const { env } = await import('../../src/config/env.js');
    const { Authority } = await import('../../src/models/Authority.js');
    const { UserAuthority } = await import('../../src/models/UserAuthority.js');
    await sequelize.sync({ force: true });
    const user = await User.create({ username: 'inventory-test', email: 'inventory-test@example.test' });
    userId = user.id;
    const apiUser = await User.create({ username: 'inventory-api', email: 'inventory-api@example.test' });
    apiUserId = apiUser.id;
    const adminRole = await Authority.create({ name: 'ROLE_ADMIN' });
    const apiRole = await Authority.create({ name: 'ROLE_API' });
    await UserAuthority.bulkCreate([
      { userId: user.id, authorityId: adminRole.id },
      { userId: apiUser.id, authorityId: apiRole.id },
    ]);
    adminToken = jwt.sign({ sub: user.id }, env.jwtSecret, { algorithm: 'HS512' });
    apiToken = jwt.sign({ sub: apiUser.id }, env.jwtSecret, { algorithm: 'HS512' });
    configurePassport();
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use((req, _res, next) => {
      const role = req.get('x-test-role');
      req.isAuthenticated = () => Boolean(role);
      if (role) req.user = { id: userId, authorities: [{ name: role }] };
      req.session = { cart: [] } as unknown as typeof req.session;
      next();
    });
    app.use(passport.initialize());
    app.use('/api/v3/admin', adminApiRouter);
    app.use('/api/v3/products', productsRouter);
    app.use('/api/v3/orders', ordersRouter);
    app.use(cartRouter);
  });

  afterAll(async () => {
    await sequelize?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function product(name: string, stockLevel: number) {
    return Product.create({ name, code: name, stockLevel, inStock: stockLevel > 0 });
  }

  it('limits inventory reads, changes, and history to administrators', async () => {
    const item = await product('Admin item', 10);
    const base = `/api/v3/admin/inventory/${item.id}`;
    expect((await request(app).get('/api/v3/admin/inventory')).status).toBe(401);
    expect((await request(app).get('/api/v3/admin/inventory').set('x-test-role', 'ROLE_USER')).status).toBe(403);
    expect((await request(app).put(base).set('x-test-role', 'ROLE_USER').send({
      stockLevel: 3, lowStockThreshold: 5, expectedStockLevel: 10,
    })).status).toBe(403);
    expect((await request(app).get(`${base}/movements`).set('x-test-role', 'ROLE_USER')).status).toBe(403);

    const response = await request(app).put(base).set('x-test-role', 'ROLE_ADMIN').send({
      stockLevel: 3, lowStockThreshold: 4, expectedStockLevel: 10,
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ stockLevel: 3, lowStockThreshold: 4, inStock: true });
    const history = await request(app).get(`${base}/movements`).set('x-test-role', 'ROLE_ADMIN');
    expect(history.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'adjustment', change: -7, stockAfter: 3, userId }),
    ]));
    const invalid = await request(app).put(base).set('x-test-role', 'ROLE_ADMIN').send({
      stockLevel: -1, lowStockThreshold: 4, expectedStockLevel: 3,
    });
    expect(invalid.status).toBe(400);
    expect((await item.reload()).stockLevel).toBe(3);
    const crossOrigin = await request(app).put(base).set('x-test-role', 'ROLE_ADMIN')
      .set('Origin', 'https://other.example').send({ stockLevel: 20, lowStockThreshold: 4, expectedStockLevel: 3 });
    expect(crossOrigin.status).toBe(403);
    expect((await request(app).get(`${base}/movements`).set('x-test-role', 'ROLE_ADMIN')
      .set('Origin', 'https://other.example')).status).toBe(403);
    const stale = await request(app).put(base).set('x-test-role', 'ROLE_ADMIN').send({
      stockLevel: 20, lowStockThreshold: 4, expectedStockLevel: 10,
    });
    expect(stale.status).toBe(409);
    expect((await item.reload()).stockLevel).toBe(3);
  });

  it('records stock changes made through the existing product API only for administrators', async () => {
    const item = await product('Product API item', 5);
    const base = `/api/v3/products/${item.id}`;
    const denied = await request(app).put(base).set('Authorization', `Bearer ${apiToken}`)
      .send({ stockLevel: 8 });
    expect(denied.status).toBe(403);
    const unchanged = await request(app).put(base).set('Authorization', `Bearer ${apiToken}`)
      .send({ stockLevel: 5, inStock: true, name: 'Updated API item' });
    expect(unchanged.status).toBe(200);
    const changed = await request(app).put(base).set('Authorization', `Bearer ${adminToken}`)
      .send({ stockLevel: 8 });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ stockLevel: 8, inStock: true, name: 'Updated API item' });
    expect(await StockMovement.findOne({ where: { productId: item.id, type: 'adjustment' } }))
      .toMatchObject({ change: 3, stockAfter: 8, userId });
  });

  it('updates stock status and records checkout movements atomically', async () => {
    const item = await product('Checkout item', 4);
    const order = await orderService.create({
      userId, cart: JSON.stringify([{ id: item.id, qty: 2 }, { id: item.id, qty: 2 }]),
    });
    expect((await item.reload()).toJSON()).toMatchObject({ stockLevel: 0, inStock: false });
    expect(await StockMovement.findOne({ where: { productId: item.id, orderId: order.id } })).toMatchObject({
      type: 'checkout', change: -4, stockAfter: 0,
    });

    await inventoryService.adjust(item.id, 6, 5, 0, userId);
    expect((await item.reload()).toJSON()).toMatchObject({ stockLevel: 6, inStock: true });
  });

  it('rolls back all stock and movements when a checkout cannot be fulfilled', async () => {
    const first = await product('Rollback first', 5);
    const second = await product('Rollback second', 1);
    const before = await Order.count();
    await expect(orderService.create({
      userId, cart: JSON.stringify([{ id: first.id, qty: 2 }, { id: second.id, qty: 2 }]),
    })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Insufficient stock') });
    expect((await first.reload()).stockLevel).toBe(5);
    expect(await StockMovement.count({ where: { productId: first.id } })).toBe(0);
    expect(await Order.count()).toBe(before);
  });

  it('returns checkout stock errors without creating an order', async () => {
    const item = await product('Web checkout item', 1);
    const count = await Order.count();
    const response = await request(app).post('/cart/checkout')
      .set('x-test-role', 'ROLE_USER').set('Accept', 'application/json')
      .type('form').send({
        appReturnTo: '/app/cart',
        cartJson: JSON.stringify([{ pid: item.id, quantity: 2 }]),
      });
    expect(response.status).toBe(409);
    expect(response.body.message).toContain('Insufficient stock');
    expect((await item.reload()).stockLevel).toBe(1);
    expect(await Order.count()).toBe(count);
  });

  it('applies stock checks to the order API while accepting empty carts', async () => {
    const item = await product('Order API item', 1);
    const rejected = await request(app).post('/api/v3/orders').set('Authorization', `Bearer ${apiToken}`)
      .send({ userId, cart: JSON.stringify([{ id: item.id, qty: 2 }]) });
    expect(rejected.status).toBe(409);
    expect((await item.reload()).stockLevel).toBe(1);
    const empty = await request(app).post('/api/v3/orders').set('Authorization', `Bearer ${apiToken}`)
      .send({ userId, cart: '[]', amount: 19.99 });
    expect(empty.status).toBe(201);
    const placed = await request(app).post('/api/v3/orders').set('Authorization', `Bearer ${apiToken}`)
      .send({ userId, cart: JSON.stringify([{ id: item.id, qty: 1 }]) });
    expect(placed.status).toBe(201);
    expect(await StockMovement.findOne({ where: { orderId: placed.body.data.id } }))
      .toMatchObject({ userId: apiUserId });
  });

  it('does not oversell when checkouts run concurrently', async () => {
    const item = await product('Concurrent item', 5);
    const cart = JSON.stringify([{ id: item.id, qty: 4 }]);
    const results = await Promise.allSettled([
      orderService.create({ userId, cart }),
      orderService.create({ userId, cart }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(result => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { status: 409 } });
    expect((await item.reload()).stockLevel).toBe(1);
    expect(await StockMovement.count({ where: { productId: item.id, type: 'checkout' } })).toBe(1);
  });

  it('preserves negative-quantity and empty-cart demos without adding stock', async () => {
    const item = await product('Demo item', 5);
    const cart = JSON.stringify([{ id: item.id, qty: -3 }, { id: item.id, qty: 2 }]);
    const order = await orderService.create({ userId, cart, amount: -1 });
    expect(order.amount).toBe(-1);
    expect((await item.reload()).stockLevel).toBe(3);
    expect(await StockMovement.count({ where: { productId: item.id, orderId: order.id } })).toBe(1);
    await expect(orderService.create({ userId, cart: '[]', amount: 19.99 })).resolves.toBeDefined();
  });

  it('preserves negative quantities in web checkout without increasing stock', async () => {
    const item = await product('Negative web item', 5);
    await item.update({ price: 10, salePrice: 10, onSale: false });
    const response = await request(app).post('/cart/checkout')
      .set('x-test-role', 'ROLE_USER').set('Accept', 'application/json')
      .type('form').send({
        appReturnTo: '/app/cart',
        cartJson: JSON.stringify([{ pid: item.id, quantity: -3 }]),
      });
    expect(response.status).toBe(200);
    const orders = await Order.findAll({ where: { userId } });
    const order = orders.find(candidate => candidate.cart.includes(item.id));
    expect(Number(order?.amount)).toBe(-30);
    expect((await item.reload()).stockLevel).toBe(5);
    expect(await StockMovement.count({ where: { productId: item.id } })).toBe(0);
  });

  it('adds the threshold to an existing product table without losing stock', async () => {
    const item = await product('Migrated item', 7);
    await sequelize.getQueryInterface().removeColumn('products', 'lowStockThreshold');
    await ensureInventorySchema();
    await ensureInventorySchema();
    expect((await item.reload()).toJSON()).toMatchObject({ stockLevel: 7, lowStockThreshold: 5 });
  });
});
