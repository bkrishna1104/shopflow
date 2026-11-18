import { createBaseApp } from './lib/base-app.js';
import { ordersRouter } from './routes.js';
import { createOrderWorkflow } from './order-workflow.js';

export function createApp({ serviceName, version, db, repo, clients, logger, metrics, state }) {
  const ordersCounter = metrics.counter('orders_total', 'Orders by final status', ['status']);
  const workflow = createOrderWorkflow({ repo, clients, logger, ordersCounter });
  return createBaseApp({
    serviceName, version, db, logger, metrics, state,
    mount: (app) => app.use('/orders', ordersRouter({ repo, workflow })),
  });
}
