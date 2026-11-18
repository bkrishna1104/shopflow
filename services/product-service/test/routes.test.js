import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createMetrics } from '../src/lib/metrics.js';
import { HttpError } from '../src/lib/errors.js';

function fakeRepo() {
  const products = [{ id: 1, sku: 'KB-001', name: 'Keyboard', price_paise: 349900, stock: 5 }];
  const find = (id) => products.find((p) => p.id === id) ?? null;
  return {
    async create({ sku, name, pricePaise, stock }) {
      if (products.some((p) => p.sku === sku)) throw new HttpError(409, 'sku already exists');
      const p = { id: products.length + 1, sku, name, price_paise: pricePaise, stock };
      products.push(p);
      return p;
    },
    findById: async (id) => find(id),
    list: async ({ limit, offset }) => products.slice(offset, offset + limit),
    async reserve(id, qty) {
      const p = find(id);
      if (!p || p.stock < qty) return null;
      p.stock -= qty;
      return p;
    },
    async release(id, qty) {
      const p = find(id);
      if (!p) return null;
      p.stock += qty;
      return p;
    },
  };
}

function buildApp() {
  return createApp({
    serviceName: 'product-service', version: 'test',
    db: { query: async () => ({ rows: [] }) },
    repo: fakeRepo(),
    logger: pino({ level: 'silent' }),
    metrics: createMetrics({ serviceName: 'product-service', version: 'test' }),
    state: { shuttingDown: false },
  });
}

test('creates, lists and gets products', async () => {
  const app = buildApp();
  const created = await request(app).post('/products').send({ sku: 'MS-002', name: 'Mouse', price_paise: 89900, stock: 3 });
  assert.equal(created.status, 201);
  assert.equal((await request(app).get('/products')).body.length, 2);
  assert.equal((await request(app).get('/products/2')).body.sku, 'MS-002');
  assert.equal((await request(app).get('/products/9')).status, 404);
});

test('validates product input', async () => {
  const app = buildApp();
  assert.equal((await request(app).post('/products').send({ sku: 'X', name: 'X', price_paise: 1.5 })).status, 400);
  assert.equal((await request(app).post('/products').send({ sku: 'X', name: 'X', price_paise: 100, stock: -1 })).status, 400);
  assert.equal((await request(app).post('/products').send({ sku: 'KB-001', name: 'X', price_paise: 100 })).status, 409);
});

test('reserve decrements stock, 409 when insufficient, 404 when missing', async () => {
  const app = buildApp();
  const ok = await request(app).post('/products/1/reserve').send({ quantity: 2 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.stock, 3);

  const tooMany = await request(app).post('/products/1/reserve').send({ quantity: 10 });
  assert.equal(tooMany.status, 409);
  assert.deepEqual(tooMany.body.details, { available: 3, requested: 10 });

  assert.equal((await request(app).post('/products/9/reserve').send({ quantity: 1 })).status, 404);
  assert.equal((await request(app).post('/products/1/reserve').send({ quantity: 0 })).status, 400);
});

test('release returns stock', async () => {
  const app = buildApp();
  const res = await request(app).post('/products/1/release').send({ quantity: 4 });
  assert.equal(res.body.stock, 9);
  assert.equal((await request(app).post('/products/9/release').send({ quantity: 1 })).status, 404);
});
