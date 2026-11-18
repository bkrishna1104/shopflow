// Entry point: reads configuration from ENVIRONMENT VARIABLES and wires real dependencies.
// WHY env vars (12-factor app): the SAME image runs on your desktop, kind and EKS;
// only the env (from docker-compose / K8s ConfigMap + Secret) changes.
import { createLogger } from './lib/logger.js';
import { createMetrics } from './lib/metrics.js';
import { createPool, dbConfigFromEnv } from './lib/db.js';
import { startServer } from './lib/server.js';
import { createNotificationRepository } from './repository.js';
import { createApp } from './app.js';

const serviceName = process.env.SERVICE_NAME ?? 'notification-service';
const version = process.env.APP_VERSION ?? 'dev';
const logger = createLogger({ name: serviceName, version, level: process.env.LOG_LEVEL });
const pool = createPool(dbConfigFromEnv(), logger);
const state = { shuttingDown: false };

const app = createApp({
  serviceName, version, logger, state,
  db: pool,
  repo: createNotificationRepository(pool),
  metrics: createMetrics({ serviceName, version }),
});

startServer({
  app, logger, pool, state,
  port: Number(process.env.PORT ?? 8080),
  shutdownDelayMs: Number(process.env.SHUTDOWN_DELAY_MS ?? 0),
});
