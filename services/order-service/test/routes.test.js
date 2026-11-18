import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createMetrics } from '../src/lib/metrics.js';
import { HttpError } from '../src/lib/errors.js';

function fakeRepo({ failCreate = false } = {}) {
  const rows = [];
  return {
    rows,
    async create({ userId, productId, quantity, totalPaise }) {
      if (failCreate) throw new Error('db down');
      const o = { id: rows.length + 1, user_id: userId, product_id: productId, quantity, total_paise: totalPaise, status: 'PENDING', payment_id: null };
      rows.push(o);
      return o;
    },
    async updateStatus(id, status, paymentId) {
      const o = rows.find((r) => r.id === id);
      Object.assign(o, { status, payment_id: paymentId });
      return { ...o };
    },
    findById: async (id) => rows.find((r) => r.id === id) ?? null,
    list: async ({ userId }) => rows.filter((r) => !userId || r.user_id === userId),
  };
}

// Fake downstream services. `payment` controls what payment-service does.
function fakeClients({ payment = 'success', stock = 10, productDown = false } = {}) {
  const calls = [];
  const reply = (status, data) => ({ status, ok: status < 400, data });
  return {
    calls,
    users: { get: async (p) => (p === '/users/1' ? reply(200, { id: 1 }) : reply(404, {})) },
    products: {
      get: async (p) => {
        if (productDown) throw new HttpError(503, 'product-service is unavailable');
        return p === '/products/1' ? reply(200, { id: 1, price_paise: 1000 }) : reply(404, {});
      },
      post: async (p, body) => {
        calls.push(p);
        if (p.endsWith('/reserve')) {
          if (stock === 'error') return reply(500, {});
          return body.quantity > stock ? reply(409, { details: { available: stock, requested: body.quantity } }) : reply(200, {});
        }
        if (p.endsWith('/release') && stock === 'release-fails') return reply(500, {});
        return reply(200, {});
      },
    },
    payments: {
      post: async (p, body) => {
        if (payment === 'down') throw new HttpError(503, 'payment-service is unavailable');
        if (payment === 'error') return reply(500, {});
        if (payment === 'declined') return reply(201, { id: 7, status: 'FAILED', failure_reason: 'card declined' });
        return reply(201, { id: 7, status: 'SUCCESS', amount_paise: body.amount_paise });
      },
    },
  };
}

function buildApp({ repo = fakeRepo(), clients = fakeClients() } = {}) {
  return createApp({
    serviceName: 'order-service', version: 'test',
    db: { query: async () => ({ rows: [] }) },
    repo, clients,
    logger: pino({ level: 'silent' }),
    metrics: createMetrics({ serviceName: 'order-service', version: 'test' }),
    state: { shuttingDown: false },
  });
}

const order = { user_id: 1, product_id: 1, quantity: 3 };

test('happy path: order is PAID with the right total', async () => {
  const app = buildApp();
  const res = await request(app).post('/orders').send(order);
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'PAID');
  assert.equal(res.body.total_paise, 3000);
  assert.equal(res.body.payment_id, 7);
  assert.match((await request(app).get('/metrics')).text, /orders_total\{status="PAID"/);
});

test('declined payment -> 402, PAYMENT_FAILED and stock released (compensation)', async () => {
  const clients = fakeClients({ payment: 'declined' });
  const res = await request(buildApp({ clients })).post('/orders').send(order);
  assert.equal(res.status, 402);
  assert.equal(res.body.status, 'PAYMENT_FAILED');
  assert.equal(res.body.failure_reason, 'card declined');
  assert.deepEqual(clients.calls, ['/products/1/reserve', '/products/1/release']);
});

test('payment-service error -> 502, unavailable -> 503, both compensate', async () => {
  for (const [mode, code] of [['error', 502], ['down', 503]]) {
    const clients = fakeClients({ payment: mode });
    const res = await request(buildApp({ clients })).post('/orders').send(order);
    assert.equal(res.status, code);
    assert.equal(res.body.status, 'PAYMENT_FAILED');
    assert.ok(clients.calls.includes('/products/1/release'));
  }
});

test('failed compensation is logged but does not crash the request', async () => {
  const res = await request(buildApp({ clients: fakeClients({ payment: 'declined', stock: 'release-fails' }) }))
    .post('/orders').send({ ...order, quantity: 1 });
  assert.equal(res.status, 402);
});

test('unknown user or product -> 422', async () => {
  const app = buildApp();
  assert.equal((await request(app).post('/orders').send({ ...order, user_id: 2 })).status, 422);
  assert.equal((await request(app).post('/orders').send({ ...order, product_id: 2 })).status, 422);
});

test('insufficient stock -> 409 with details; reserve error -> 502', async () => {
  const res = await request(buildApp({ clients: fakeClients({ stock: 2 }) })).post('/orders').send(order);
  assert.equal(res.status, 409);
  assert.deepEqual(res.body.details, { available: 2, requested: 3 });
  assert.equal((await request(buildApp({ clients: fakeClients({ stock: 'error' }) })).post('/orders').send(order)).status, 502);
});

test('downstream service down -> 503', async () => {
  const res = await request(buildApp({ clients: fakeClients({ productDown: true }) })).post('/orders').send(order);
  assert.equal(res.status, 503);
});

test('database failure after reservation releases the stock', async () => {
  const clients = fakeClients();
  const res = await request(buildApp({ repo: fakeRepo({ failCreate: true }), clients })).post('/orders').send(order);
  assert.equal(res.status, 500);
  assert.deepEqual(clients.calls, ['/products/1/reserve', '/products/1/release']);
});

test('upstream non-404 error on lookup -> 502', async () => {
  const clients = fakeClients();
  clients.users.get = async () => ({ status: 500, ok: false, data: {} });
  assert.equal((await request(buildApp({ clients })).post('/orders').send(order)).status, 502);
});

test('quantity defaults to 1; validation; lookups', async () => {
  const app = buildApp();
  const res = await request(app).post('/orders').send({ user_id: 1, product_id: 1 });
  assert.equal(res.body.quantity, 1);
  assert.equal((await request(app).post('/orders').send({ user_id: 'x', product_id: 1 })).status, 400);
  assert.equal((await request(app).get('/orders/1')).body.status, 'PAID');
  assert.equal((await request(app).get('/orders/9')).status, 404);
  assert.equal((await request(app).get('/orders?user_id=1')).body.length, 1);
  assert.equal((await request(app).get('/orders')).body.length, 1);
});
