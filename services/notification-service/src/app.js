import { createBaseApp } from './lib/base-app.js';
import { notificationsRouter } from './routes.js';

export function createApp({ serviceName, version, db, repo, logger, metrics, state }) {
  const sentCounter = metrics.counter('notifications_sent_total', 'Notifications sent', ['channel', 'type']);
  return createBaseApp({
    serviceName, version, db, logger, metrics, state,
    mount: (app) => app.use('/notifications', notificationsRouter({ repo, logger, sentCounter })),
  });
}
