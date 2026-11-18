import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createMetrics } from '../src/lib/metrics.js';

function fakeRepo() {
  const rows = [];
  return {
    async create({ userId, orderId, channel, type, message }) {
      const n = { id: rows.length + 1, user_id: userId, order_id: orderId, channel, type, message, status: 'SENT' };
      rows.push(n);
      return n;
    },
    findById: async (id) => rows.find((n) => n.id === id) ?? null,
    list: async ({ userId }) => rows.filter((n) => !userId || n.user_id === userId),
  };
}

function buildApp() {
  return createApp({
    serviceName: 'notification-service', version: 'test',
    db: { query: async () => ({ rows: [] }) },
    repo: fakeRepo(),
    logger: pino({ level: 'silent' }),
    metrics: createMetrics({ serviceName: 'notification-service', version: 'test' }),
    state: { shuttingDown: false },
  });
}

test('sends a notification and counts it', async () => {
  const app = buildApp();
  const res = await request(app).post('/notifications').send({ user_id: 1, order_id: 7, type: 'PAYMENT_RECEIPT', message: 'Paid' });
  assert.equal(res.status, 201);
  assert.equal(res.body.channel, 'EMAIL');
  assert.equal(res.body.status, 'SENT');
  const metrics = await request(app).get('/metrics');
  assert.match(metrics.text, /notifications_sent_total\{channel="EMAIL",type="PAYMENT_RECEIPT"/);
});

test('validates input', async () => {
  const app = buildApp();
  assert.equal((await request(app).post('/notifications').send({ type: 'X', message: 'm' })).status, 400);
  assert.equal((await request(app).post('/notifications').send({ user_id: 1, type: 'X', message: 'm', channel: 'PIGEON' })).status, 400);
  assert.equal((await request(app).post('/notifications').send({ user_id: 1, type: 'X', message: '' })).status, 400);
});

test('lists by user and gets by id', async () => {
  const app = buildApp();
  await request(app).post('/notifications').send({ user_id: 1, type: 'A', message: 'm', channel: 'sms' });
  await request(app).post('/notifications').send({ user_id: 2, type: 'B', message: 'm' });
  assert.equal((await request(app).get('/notifications?user_id=1')).body.length, 1);
  assert.equal((await request(app).get('/notifications')).body.length, 2);
  assert.equal((await request(app).get('/notifications/1')).body.channel, 'SMS');
  assert.equal((await request(app).get('/notifications/99')).status, 404);
});
