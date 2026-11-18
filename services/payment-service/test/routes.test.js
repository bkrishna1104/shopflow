import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createMetrics } from '../src/lib/metrics.js';

function fakeRepo() {
  const rows = [];
  const findByOrderId = async (orderId) => rows.find((p) => p.order_id === orderId) ?? null;
  return {
    rows,
    findByOrderId,
    async create({ orderId, userId, amountPaise, status, failureReason }) {
      const dup = await findByOrderId(orderId);
      if (dup) return { payment: dup, created: false };
      const p = { id: rows.length + 1, order_id: orderId, user_id: userId, amount_paise: amountPaise, status, failure_reason: failureReason };
      rows.push(p);
      return { payment: p, created: true };
    },
    findById: async (id) => rows.find((p) => p.id === id) ?? null,
    list: async () => [...rows].reverse(),
  };
}

function fakeNotifier(mode = 'ok') {
  const sent = [];
  return {
    sent,
    async post(path, body) {
      if (mode === 'down') throw new Error('ECONNREFUSED');
      sent.push({ path, body });
      return mode === 'reject' ? { ok: false, status: 400, data: {} } : { ok: true, status: 201, data: {} };
    },
  };
}

function buildApp({ repo = fakeRepo(), notifier = fakeNotifier(), chaos, random = () => 0.99, maxAmountPaise } = {}) {
  return createApp({
    serviceName: 'payment-service', version: 'test',
    db: { query: async () => ({ rows: [] }) },
    repo, notifier, chaos, random, maxAmountPaise,
    logger: pino({ level: 'silent' }),
    metrics: createMetrics({ serviceName: 'payment-service', version: 'test' }),
    state: { shuttingDown: false },
  });
}

const body = { order_id: 10, user_id: 1, amount_paise: 49900 };

test('successful payment sends a receipt and is counted', async () => {
  const notifier = fakeNotifier();
  const app = buildApp({ notifier });
  const res = await request(app).post('/payments').send(body);
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'SUCCESS');
  assert.equal(notifier.sent.length, 1);
  assert.match(notifier.sent[0].body.message, /₹499\.00 for order #10/);
  assert.match((await request(app).get('/metrics')).text, /payments_total\{status="SUCCESS"/);
});

test('is idempotent: same order_id twice returns the first payment with 200', async () => {
  const app = buildApp();
  const first = await request(app).post('/payments').send(body);
  const second = await request(app).post('/payments').send(body);
  assert.equal(second.status, 200);
  assert.equal(second.body.id, first.body.id);
});

test('concurrent duplicate insert (race) returns 200 with the winning row', async () => {
  const repo = fakeRepo();
  const original = repo.findByOrderId;
  let calls = 0;
  // First lookup says "no payment yet" (simulates the race window), then real behaviour.
  repo.findByOrderId = async (id) => (calls++ === 0 ? null : original(id));
  repo.rows.push({ id: 1, order_id: 10, user_id: 1, amount_paise: 49900, status: 'SUCCESS' });
  const res = await request(buildApp({ repo })).post('/payments').send(body);
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 1);
});

test('amount over the limit is FAILED (business failure, not a 5xx)', async () => {
  const res = await request(buildApp({ maxAmountPaise: 1000 })).post('/payments').send(body);
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'FAILED');
  assert.match(res.body.failure_reason, /limit of ₹10\.00/);
});

test('chaos: declineRate declines, errorRate returns 500, latency is applied', async () => {
  const declined = await request(buildApp({ chaos: { latencyMs: 0, errorRate: 0, declineRate: 1 }, random: () => 0.5 }))
    .post('/payments').send(body);
  assert.equal(declined.body.status, 'FAILED');
  assert.equal(declined.body.failure_reason, 'card declined (simulated)');

  const crashed = await request(buildApp({ chaos: { latencyMs: 0, errorRate: 1, declineRate: 0 }, random: () => 0.5 }))
    .post('/payments').send(body);
  assert.equal(crashed.status, 500);

  const start = Date.now();
  await request(buildApp({ chaos: { latencyMs: 50, errorRate: 0, declineRate: 0 } })).post('/payments').send(body);
  assert.ok(Date.now() - start >= 45);
});

test('notification failures never fail the payment', async () => {
  for (const mode of ['down', 'reject']) {
    const res = await request(buildApp({ notifier: fakeNotifier(mode) })).post('/payments').send(body);
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'SUCCESS');
  }
});

test('validation and lookups', async () => {
  const app = buildApp();
  assert.equal((await request(app).post('/payments').send({ order_id: 1, user_id: 1 })).status, 400);
  await request(app).post('/payments').send(body);
  assert.equal((await request(app).get('/payments/1')).body.order_id, 10);
  assert.equal((await request(app).get('/payments/2')).status, 404);
  assert.equal((await request(app).get('/payments?order_id=10')).body.length, 1);
  assert.equal((await request(app).get('/payments?order_id=11')).body.length, 0);
  assert.equal((await request(app).get('/payments')).body.length, 1);
});
