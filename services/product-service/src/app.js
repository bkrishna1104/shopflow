// Builds the Express app from injected dependencies (Dependency Injection).
// WHY: tests pass fakes, production passes the real Postgres pool.
import { createBaseApp } from './lib/base-app.js';
import { productsRouter } from './routes.js';

export function createApp({ serviceName, version, db, repo, logger, metrics, state }) {
  return createBaseApp({
    serviceName, version, db, logger, metrics, state,
    mount: (app) => app.use('/products', productsRouter({ repo })),
  });
}
