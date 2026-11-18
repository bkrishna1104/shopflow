// Tests for the shared library (identical copy in every service).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { createBaseApp } from '../src/lib/base-app.js';
import { createMetrics } from '../src/lib/metrics.js';
import { HttpError } from '../src/lib/errors.js';
import { positiveInt, nonNegativeInt, nonEmptyString, pagination } from '../src/lib/validate.js';
import { createServiceClient } from '../src/lib/http-client.js';

const logger = pino({ level: 'silent' });

function buildApp({ dbOk = true, state = { shuttingDown: false } } = {}) {
  const db = { query: async () => { if (!dbOk) throw new Error('down'); return { rows: [] }; } };
  return createBaseApp({
    serviceName: 'test-service', version: '1.2.3', db, logger, state,
    metrics: createMetrics({ serviceName: 'test-service', version: '1.2.3' }),
    mount: (app) => {
      app.get('/items/:id', (req, res) => res.json({ id: positiveInt(req.params.id, 'id') }));
      app.get('/boom', () => { throw new Error('secret internal detail'); });
      app.get('/teapot', () => { throw new HttpError(418, 'short and stout', { hint: 'tea' }); });
    },
  });
}

test('liveness is always UP and carries the version header', async () => {
  const res = await request(buildApp({ dbOk: false })).get('/health/live');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'UP');
  assert.equal(res.headers['x-app-version'], '1.2.3');
});

test('readiness reflects database health', async () => {
  assert.equal((await request(buildApp()).get('/health/ready')).status, 200);
  const down = await request(buildApp({ dbOk: false })).get('/health/ready');
  assert.equal(down.status, 503);
  assert.equal(down.body.status, 'NOT_READY');
});

test('readiness returns 503 while shutting down', async () => {
  const res = await request(buildApp({ state: { shuttingDown: true } })).get('/health/ready');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'SHUTTING_DOWN');
});

test('metrics use route templates, not raw ids', async () => {
  const app = buildApp();
  await request(app).get('/items/42');
  await request(app).get('/items/abc');
  const res = await request(app).get('/metrics');
  assert.equal(res.status, 200);
  assert.match(res.text, /http_requests_total\{method="GET",route="\/items\/:id",status_code="200"/);
  assert.match(res.text, /status_code="400"/);
  assert.doesNotMatch(res.text, /\/items\/42/);
});

test('unknown routes return 404 JSON', async () => {
  const res = await request(buildApp()).get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Not Found');
});

test('unexpected errors are hidden, HttpErrors are shown', async () => {
  const boom = await request(buildApp()).get('/boom');
  assert.equal(boom.status, 500);
  assert.equal(boom.body.error, 'Internal Server Error');
  const tea = await request(buildApp()).get('/teapot');
  assert.equal(tea.status, 418);
  assert.deepEqual(tea.body, { error: 'short and stout', details: { hint: 'tea' } });
});

test('malformed JSON body becomes 400', async () => {
  const app = buildApp();
  const res = await request(app).post('/items/1').set('content-type', 'application/json').send('{bad');
  assert.equal(res.status, 400);
});

test('validators', () => {
  assert.equal(positiveInt('7', 'x'), 7);
  assert.throws(() => positiveInt(0, 'x'), /positive integer/);
  assert.throws(() => positiveInt('1.5', 'x'));
  assert.equal(nonNegativeInt(0, 'x'), 0);
  assert.throws(() => nonNegativeInt(-1, 'x'));
  assert.equal(nonEmptyString('  hi ', 'x'), 'hi');
  assert.throws(() => nonEmptyString('', 'x'), /required/);
  assert.throws(() => nonEmptyString('abcdef', 'x', 3), /at most 3/);
  assert.deepEqual(pagination({}), { limit: 50, offset: 0 });
  assert.deepEqual(pagination({ limit: '500', offset: '5' }), { limit: 100, offset: 5 });
});

test('service client: success, non-JSON body and network failure', async () => {
  const okClient = createServiceClient({
    baseUrl: 'http://x', name: 'svc',
    fetchImpl: async (url, opts) => ({ status: 201, ok: true, text: async () => JSON.stringify({ url, method: opts.method, body: JSON.parse(opts.body) }) }),
  });
  const r = await okClient.post('/a', { n: 1 });
  assert.deepEqual(r, { status: 201, ok: true, version: null, data: { url: 'http://x/a', method: 'POST', body: { n: 1 } } });

  const textClient = createServiceClient({ baseUrl: 'http://x', name: 'svc', fetchImpl: async () => ({ status: 502, ok: false, text: async () => 'Bad Gateway' }) });
  assert.deepEqual((await textClient.get('/b')).data, { raw: 'Bad Gateway' });

  const emptyClient = createServiceClient({ baseUrl: 'http://x', name: 'svc', fetchImpl: async () => ({ status: 204, ok: true, text: async () => '' }) });
  assert.equal((await emptyClient.get('/c')).data, null);

  const downClient = createServiceClient({ baseUrl: 'http://x', name: 'svc', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(downClient.get('/d'), (err) => err.status === 503 && /svc is unavailable/.test(err.message));

  const slowClient = createServiceClient({ baseUrl: 'http://x', name: 'svc', fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } });
  await assert.rejects(slowClient.get('/e'), (err) => err.details.cause === 'timeout');
});
// (db config test omitted: web-ui has no database, so lib/db.js is not included)
