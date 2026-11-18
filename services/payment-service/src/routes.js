import { Router } from 'express';
import { HttpError } from './lib/errors.js';
import { positiveInt, pagination } from './lib/validate.js';

const formatRupees = (paise) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * CHAOS KNOBS (all default to 0 = off). Used in the final demo to create a
 * deliberately BAD canary version and prove that automatic rollback works:
 *   chaos.latencyMs   -> extra delay per payment       (breaks "P95 <= 500 ms")
 *   chaos.errorRate   -> fraction of requests that 500 (breaks "5xx <= 1%")
 *   chaos.declineRate -> fraction of payments declined (breaks "payment fail <= 0.5%")
 */
export function paymentsRouter({ repo, notifier, logger, chaos, random, sleep, paymentsCounter, maxAmountPaise }) {
  const router = Router();

  async function sendReceipt(payment) {
    // Best effort: a notification outage must NOT fail a payment that already
    // succeeded. (A message queue would be even better — a later improvement.)
    try {
      const res = await notifier.post('/notifications', {
        user_id: payment.user_id,
        order_id: payment.order_id,
        type: 'PAYMENT_RECEIPT',
        message: `Payment of ${formatRupees(payment.amount_paise)} for order #${payment.order_id} was successful.`,
      });
      if (!res.ok) logger.warn({ status: res.status, paymentId: payment.id }, 'receipt notification rejected');
    } catch (err) {
      logger.warn({ err: err.message, paymentId: payment.id }, 'notification-service unavailable, receipt not sent');
    }
  }

  // POST /payments {order_id, user_id, amount_paise}
  router.post('/', async (req, res) => {
    const orderId = positiveInt(req.body?.order_id, 'order_id');
    const userId = positiveInt(req.body?.user_id, 'user_id');
    const amountPaise = positiveInt(req.body?.amount_paise, 'amount_paise');

    // IDEMPOTENCY: if order-service retries (timeout, network blip), we must not
    // charge the customer twice. One payment per order_id, always.
    const existing = await repo.findByOrderId(orderId);
    if (existing) return res.status(200).json(existing);

    if (chaos.latencyMs > 0) await sleep(chaos.latencyMs);
    if (random() < chaos.errorRate) throw new Error('simulated payment processor crash');

    let status = 'SUCCESS';
    let failureReason = null;
    if (amountPaise > maxAmountPaise) {
      status = 'FAILED';
      failureReason = `amount exceeds single-payment limit of ${formatRupees(maxAmountPaise)}`;
    } else if (random() < chaos.declineRate) {
      status = 'FAILED';
      failureReason = 'card declined (simulated)';
    }

    const { payment, created } = await repo.create({ orderId, userId, amountPaise, status, failureReason });
    if (!created) return res.status(200).json(payment);

    // BUSINESS METRIC: Phase 9 checks "payment failure rate <= 0.5%" from this counter.
    paymentsCounter.inc({ status });
    logger.info({ paymentId: payment.id, orderId, status }, 'payment processed');
    if (status === 'SUCCESS') await sendReceipt(payment);
    res.status(201).location(`/payments/${payment.id}`).json(payment);
  });

  router.get('/', async (req, res) => {
    if (req.query.order_id !== undefined) {
      const p = await repo.findByOrderId(positiveInt(req.query.order_id, 'order_id'));
      return res.json(p ? [p] : []);
    }
    res.json(await repo.list(pagination(req.query)));
  });

  router.get('/:id', async (req, res) => {
    const p = await repo.findById(positiveInt(req.params.id, 'id'));
    if (!p) throw new HttpError(404, 'payment not found');
    res.json(p);
  });

  return router;
}
