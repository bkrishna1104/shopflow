import { createLogger } from './lib/logger.js';
import { createMetrics } from './lib/metrics.js';
import { createPool, dbConfigFromEnv } from './lib/db.js';
import { createServiceClient } from './lib/http-client.js';
import { startServer } from './lib/server.js';
import { createOrderRepository } from './repository.js';
import { createApp } from './app.js';

const env = process.env;
const serviceName = env.SERVICE_NAME ?? 'order-service';
const version = env.APP_VERSION ?? 'dev';
const logger = createLogger({ name: serviceName, version, level: env.LOG_LEVEL });
const pool = createPool(dbConfigFromEnv(), logger);
const state = { shuttingDown: false };
const timeoutMs = Number(env.HTTP_TIMEOUT_MS ?? 3000);

// Service URLs come from env. In Docker Compose / Kubernetes they are DNS names
// like http://payment-service:8080 — the platform resolves them to the right container/pod.
const clients = {
  users: createServiceClient({ name: 'user-service', baseUrl: env.USER_SERVICE_URL ?? 'http://localhost:3001', timeoutMs }),
  products: createServiceClient({ name: 'product-service', baseUrl: env.PRODUCT_SERVICE_URL ?? 'http://localhost:3002', timeoutMs }),
  payments: createServiceClient({ name: 'payment-service', baseUrl: env.PAYMENT_SERVICE_URL ?? 'http://localhost:3004', timeoutMs }),
};

const app = createApp({
  serviceName, version, logger, state, clients,
  db: pool,
  repo: createOrderRepository(pool),
  metrics: createMetrics({ serviceName, version }),
});

startServer({
  app, logger, pool, state,
  port: Number(env.PORT ?? 8080),
  shutdownDelayMs: Number(env.SHUTDOWN_DELAY_MS ?? 0),
});
