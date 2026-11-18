import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createMetrics } from '../src/lib/metrics.js';
import { HttpError } from '../src/lib/errors.js';

function fakeClients({ paymentsDown = false } = {}) {
  const calls = [];
  const svc = (name, version = '1.0.0') => ({
    get: async (path) => {
      calls.push(`GET ${name}${path}`);
      if (path === '/health/ready') return { status: 200, ok: true, data: { service: name, version } };
      return { status: 200, ok: true, data: [{ from: name }], version };
    },
    post: async (path, body) => {
      calls.push(`POST ${name}${path}`);
      return { status: 201, ok: true, data: { ...body, status: 'PAID' }, version };
    },
  });
  const clients = {
    users: svc('user-service'),
    products: svc('product-service'),
    orders: svc('order-service', '1.1.0'),
    payments: svc('payment-service'),
    notifications: svc('notification-service'),
  };
  if (paymentsDown) clients.payments.get = async () => { throw new HttpError(503, 'down'); };
  return { clients, calls };
}

function buildApp(opts) {
  const { clients, calls } = fakeClients(opts);
  const app = createApp({
    serviceName: 'web-ui', version: 'test', clients,
    logger: pino({ level: 'silent' }),
    metrics: createMetrics({ serviceName: 'web-ui', version: 'test' }),
    state: { shuttingDown: false },
  });
  return { app, calls };
}

test('serves the shop page', async () => {
  const res = await request(buildApp().app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /ShopFlow/);
});

test('ready without a database', async () => {
  assert.equal((await request(buildApp().app).get('/health/ready')).status, 200);
});

test('relays lists and the upstream version header', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/api/products');
  assert.deepEqual(res.body, [{ from: 'product-service' }]);
  assert.equal(res.headers['x-upstream-version'], '1.0.0');
  assert.equal((await request(app).get('/api/users')).status, 200);
});

test('places orders, forwarding only known fields', async () => {
  const { app, calls } = buildApp();
  const res = await request(app).post('/api/orders').send({ user_id: 1, product_id: 2, quantity: 1, admin: true });
  assert.equal(res.status, 201);
  assert.equal(res.body.admin, undefined);
  assert.equal(res.headers['x-upstream-version'], '1.1.0');
  assert.ok(calls.includes('POST order-service/orders'));
});

test('creates customers', async () => {
  const res = await request(buildApp().app).post('/api/users').send({ name: 'A', email: 'a@b.co' });
  assert.equal(res.status, 201);
});

test('per-customer lists require a valid user_id', async () => {
  const { app, calls } = buildApp();
  assert.equal((await request(app).get('/api/orders?user_id=3')).status, 200);
  assert.equal((await request(app).get('/api/notifications?user_id=3')).status, 200);
  assert.ok(calls.includes('GET order-service/orders?user_id=3&limit=20'));
  assert.equal((await request(app).get('/api/orders?user_id=abc')).status, 400);
  assert.equal((await request(app).get('/api/notifications')).status, 400);
});

test('status lists every service, marking unreachable ones', async () => {
  const res = await request(buildApp({ paymentsDown: true }).app).get('/api/status');
  assert.equal(res.body.length, 6);
  assert.deepEqual(res.body[0], { service: 'web-ui', ok: true, version: 'test', latencyMs: 0 });
  const payments = res.body.find((s) => s.service === 'payment-service');
  assert.equal(payments.ok, false);
  assert.equal(res.body.find((s) => s.service === 'order-service').version, '1.1.0');
});
