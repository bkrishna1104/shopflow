import { setTimeout as sleep } from 'node:timers/promises';
import { createBaseApp } from './lib/base-app.js';
import { paymentsRouter } from './routes.js';

const NO_CHAOS = { latencyMs: 0, errorRate: 0, declineRate: 0 };

export function createApp({
  serviceName, version, db, repo, notifier, logger, metrics, state,
  chaos = NO_CHAOS, random = Math.random, maxAmountPaise = 10_000_000, // ₹1,00,000
}) {
  const paymentsCounter = metrics.counter('payments_total', 'Payments processed by outcome', ['status']);
  if (chaos.latencyMs || chaos.errorRate || chaos.declineRate) {
    logger.warn({ chaos }, 'CHAOS MODE ENABLED — this version is intentionally faulty');
  }
  return createBaseApp({
    serviceName, version, db, logger, metrics, state,
    mount: (app) => app.use('/payments', paymentsRouter({
      repo, notifier, logger, chaos, random, sleep, paymentsCounter, maxAmountPaise,
    })),
  });
}
