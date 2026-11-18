// Unit tests: run with a FAKE repository -> fast, no database, run on every commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { createMetrics } from '../src/lib/metrics.js';
import { HttpError } from '../src/lib/errors.js';

function fakeRepo() {
  const users = [{ id: 1, name: 'Asha', email: 'asha@example.com' }];
  return {
    async create({ name, email }) {
      if (users.some((u) => u.email === email)) throw new HttpError(409, 'email is already registered');
      const user = { id: users.length + 1, name, email };
      users.push(user);
      return user;
    },
    async findById(id) { return users.find((u) => u.id === id) ?? null; },
    async list({ limit, offset }) { return users.slice(offset, offset + limit); },
  };
}

function buildApp() {
  return createApp({
    serviceName: 'user-service', version: 'test',
    db: { query: async () => ({ rows: [] }) },
    repo: fakeRepo(),
    logger: pino({ level: 'silent' }),
    metrics: createMetrics({ serviceName: 'user-service', version: 'test' }),
    state: { shuttingDown: false },
  });
}

test('creates a user and normalises the email', async () => {
  const res = await request(buildApp()).post('/users').send({ name: ' Rohan ', email: 'Rohan@Example.com' });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Rohan');
  assert.equal(res.body.email, 'rohan@example.com');
  assert.equal(res.headers.location, '/users/2');
});

test('rejects invalid input with 400', async () => {
  const app = buildApp();
  assert.equal((await request(app).post('/users').send({ email: 'a@b.co' })).status, 400);
  assert.equal((await request(app).post('/users').send({ name: 'X', email: 'not-an-email' })).status, 400);
  assert.equal((await request(app).post('/users').send()).status, 400);
});

test('duplicate email returns 409', async () => {
  const res = await request(buildApp()).post('/users').send({ name: 'Dup', email: 'asha@example.com' });
  assert.equal(res.status, 409);
});

test('gets a user by id, 404 when missing, 400 when id is bad', async () => {
  const app = buildApp();
  assert.equal((await request(app).get('/users/1')).body.name, 'Asha');
  assert.equal((await request(app).get('/users/99')).status, 404);
  assert.equal((await request(app).get('/users/abc')).status, 400);
});

test('lists users', async () => {
  const res = await request(buildApp()).get('/users?limit=10');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
});
