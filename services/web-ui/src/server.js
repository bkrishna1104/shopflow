import { createLogger } from './lib/logger.js';
import { createMetrics } from './lib/metrics.js';
import { createServiceClient } from './lib/http-client.js';
import { startServer } from './lib/server.js';
import { createApp } from './app.js';

const env = process.env;
const serviceName = env.SERVICE_NAME ?? 'web-ui';
const version = env.APP_VERSION ?? 'dev';
const logger = createLogger({ name: serviceName, version, level: env.LOG_LEVEL });
const state = { shuttingDown: false };
const timeoutMs = Number(env.HTTP_TIMEOUT_MS ?? 5000);
const client = (name, url, fallback) => createServiceClient({ name, baseUrl: url ?? fallback, timeoutMs });

const clients = {
  users: client('user-service', env.USER_SERVICE_URL, 'http://localhost:3001'),
  products: client('product-service', env.PRODUCT_SERVICE_URL, 'http://localhost:3002'),
  orders: client('order-service', env.ORDER_SERVICE_URL, 'http://localhost:3003'),
  payments: client('payment-service', env.PAYMENT_SERVICE_URL, 'http://localhost:3004'),
  notifications: client('notification-service', env.NOTIFICATION_SERVICE_URL, 'http://localhost:3005'),
};

const app = createApp({ serviceName, version, clients, logger, state, metrics: createMetrics({ serviceName, version }) });

startServer({
  app, logger, state,
  pool: { end: async () => {} }, // no database to close
  port: Number(env.PORT ?? 8080),
  shutdownDelayMs: Number(env.SHUTDOWN_DELAY_MS ?? 0),
});
