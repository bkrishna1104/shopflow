import { createLogger } from './lib/logger.js';
import { createMetrics } from './lib/metrics.js';
import { createPool, dbConfigFromEnv } from './lib/db.js';
import { createServiceClient } from './lib/http-client.js';
import { startServer } from './lib/server.js';
import { createPaymentRepository } from './repository.js';
import { createApp } from './app.js';

const env = process.env;
const serviceName = env.SERVICE_NAME ?? 'payment-service';
const version = env.APP_VERSION ?? 'dev';
const logger = createLogger({ name: serviceName, version, level: env.LOG_LEVEL });
const pool = createPool(dbConfigFromEnv(), logger);
const state = { shuttingDown: false };

const app = createApp({
  serviceName, version, logger, state,
  db: pool,
  repo: createPaymentRepository(pool),
  metrics: createMetrics({ serviceName, version }),
  notifier: createServiceClient({
    name: 'notification-service',
    baseUrl: env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3005',
    timeoutMs: Number(env.HTTP_TIMEOUT_MS ?? 3000),
  }),
  chaos: {
    latencyMs: Number(env.CHAOS_LATENCY_MS ?? 0),
    errorRate: Number(env.CHAOS_ERROR_RATE ?? 0),
    declineRate: Number(env.CHAOS_DECLINE_RATE ?? 0),
  },
  maxAmountPaise: Number(env.MAX_AMOUNT_PAISE ?? 10_000_000),
});

startServer({
  app, logger, pool, state,
  port: Number(env.PORT ?? 8080),
  shutdownDelayMs: Number(env.SHUTDOWN_DELAY_MS ?? 0),
});
