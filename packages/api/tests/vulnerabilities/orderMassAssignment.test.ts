import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Order creation mass assignment - CWE-915', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iwa-order-mass-assignment-test-'));
  let sequelize: typeof import('../../src/config/database.js').sequelize;
  let Order: typeof import('../../src/models/Order.js').Order;
  let app: express.Express;
  let attackerToken: string;
  let victimId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = path.join(directory, 'order-mass-assignment.sqlite');
    ({ sequelize } = await import('../../src/config/database.js'));
    ({ Order } = await import('../../src/models/Order.js'));
    const { User } = await import('../../src/models/User.js');
    const { ordersRouter } = await import('../../src/api/v3/orders.js');
    const { configurePassport } = await import('../../src/config/passport.js');
    const { env } = await import('../../src/config/env.js');
    await sequelize.sync({ force: true });
    const attacker = await User.create({ username: 'order-attacker', email: 'order-attacker@example.test' });
    const victim = await User.create({ username: 'order-victim', email: 'order-victim@example.test' });
    victimId = victim.id;
    attackerToken = jwt.sign({ sub: attacker.id }, env.jwtSecret, { algorithm: 'HS512' });
    configurePassport();
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    app.use('/api/v3/orders', ordersRouter);
  });

  afterAll(async () => {
    await sequelize?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('VULNERABLE: a user can create an order owned by another user with client-chosen id and shipping state', async () => {
    const forgedId = '11111111-2222-4333-8444-555555555555';
    const response = await request(app).post('/api/v3/orders')
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({
        id: forgedId, orderNum: 'ORD-FORGED', amount: 0, userId: victimId,
        shipped: true, shippedDate: '2026-01-01T00:00:00.000Z', shippingAddress: 'Attacker address',
      });

    expect(response.status).toBe(201);
    const order = await Order.findByPk(forgedId);
    expect(order?.userId).toBe(victimId);
    expect(order?.orderNum).toBe('ORD-FORGED');
    expect(order?.shipped).toBe(true);
    expect(order?.shippingAddress).toBe('Attacker address');
  });
});
