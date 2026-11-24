import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Restricted product ordering - CWE-840', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iwa-restricted-order-test-'));
  let sequelize: typeof import('../../src/config/database.js').sequelize;
  let Product: typeof import('../../src/models/Product.js').Product;
  let app: express.Express;
  let token: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = path.join(directory, 'restricted-order.sqlite');
    ({ sequelize } = await import('../../src/config/database.js'));
    ({ Product } = await import('../../src/models/Product.js'));
    const { User } = await import('../../src/models/User.js');
    const { ordersRouter } = await import('../../src/api/v3/orders.js');
    const { configurePassport } = await import('../../src/config/passport.js');
    const { env } = await import('../../src/config/env.js');
    await sequelize.sync({ force: true });
    const customer = await User.create({ username: 'restricted-order-user', email: 'restricted-order@example.test' });
    token = jwt.sign({ sub: customer.id }, env.jwtSecret, { algorithm: 'HS512' });
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

  it('VULNERABLE: a normal user can order a controlled, pharmacy-only, consultation, age-restricted product', async () => {
    const codeine = await Product.create({
      name: 'Codeine Phosphate 8mg', code: 'RESTRICTED-1', stockLevel: 5, inStock: true,
      onPrescription: true, controlledMedicine: true, pharmacyOnly: true, requiresConsultation: true, minimumAge: 18,
    });

    const response = await request(app).post('/api/v3/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderNum: 'ORD-RESTRICTED', amount: 1, cart: JSON.stringify([{ id: codeine.id, qty: 2 }]) });

    expect(response.status).toBe(201);
    await codeine.reload();
    expect(codeine.stockLevel).toBe(3);
  });
});
