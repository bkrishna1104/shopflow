// The order workflow: a SAGA (orchestration style).
//
// WHY: in a monolith, "reserve stock + charge card + save order" would be ONE
// database transaction. With database-per-service there is no shared transaction.
// A saga runs the steps one by one and, if a later step fails, runs
// COMPENSATING actions to undo earlier ones (here: release the reserved stock).
//
//   1. user exists?          (user-service)
//   2. product + price       (product-service)
//   3. reserve stock         (product-service)        <- compensated by "release"
//   4. save order PENDING    (orders_db)
//   5. charge payment        (payment-service -> notification-service)
//   6a. success -> PAID
//   6b. failure -> release stock, PAYMENT_FAILED
import { HttpError } from './lib/errors.js';

export function createOrderWorkflow({ repo, clients, logger, ordersCounter }) {
  async function fetchRequired(client, path, what) {
    const res = await client.get(path); // throws HttpError 503 if the service is down
    if (res.status === 404) throw new HttpError(422, `${what} does not exist`);
    if (!res.ok) throw new HttpError(502, `${what} lookup failed`, { upstreamStatus: res.status });
    return res.data;
  }

  async function releaseStock(productId, quantity, orderId) {
    try {
      const res = await clients.products.post(`/products/${productId}/release`, { quantity });
      if (!res.ok) throw new Error(`status ${res.status}`);
      logger.info({ orderId, productId, quantity }, 'compensation: stock released');
    } catch (err) {
      // In production this would go to a retry queue / alert. Never swallow silently.
      logger.error({ orderId, productId, quantity, err: err.message }, 'COMPENSATION FAILED: stock not released');
    }
  }

  async function chargePayment(order) {
    try {
      const res = await clients.payments.post('/payments', {
        order_id: order.id, user_id: order.user_id, amount_paise: order.total_paise,
      });
      if (res.ok) return { payment: res.data };
      logger.error({ orderId: order.id, upstreamStatus: res.status }, 'payment-service returned an error');
      return { payment: null, httpStatus: 502, reason: 'payment-service error' };
    } catch (err) {
      logger.error({ orderId: order.id, err: err.message }, 'payment-service unavailable');
      return { payment: null, httpStatus: 503, reason: 'payment-service unavailable' };
    }
  }

  return {
    async placeOrder({ userId, productId, quantity }) {
      await fetchRequired(clients.users, `/users/${userId}`, 'user');
      const product = await fetchRequired(clients.products, `/products/${productId}`, 'product');

      const reservation = await clients.products.post(`/products/${productId}/reserve`, { quantity });
      if (reservation.status === 409) throw new HttpError(409, 'insufficient stock', reservation.data?.details);
      if (!reservation.ok) throw new HttpError(502, 'stock reservation failed', { upstreamStatus: reservation.status });

      let order;
      try {
        order = await repo.create({ userId, productId, quantity, totalPaise: product.price_paise * quantity });
      } catch (err) {
        await releaseStock(productId, quantity, null);
        throw err;
      }

      const { payment, httpStatus, reason } = await chargePayment(order);

      if (payment?.status === 'SUCCESS') {
        order = await repo.updateStatus(order.id, 'PAID', payment.id);
        ordersCounter.inc({ status: 'PAID' });
        return { order, httpStatus: 201 };
      }

      await releaseStock(productId, quantity, order.id);
      order = await repo.updateStatus(order.id, 'PAYMENT_FAILED', payment?.id ?? null);
      ordersCounter.inc({ status: 'PAYMENT_FAILED' });
      // 402 = payment declined (business outcome); 502/503 = technical failure.
      return {
        order,
        httpStatus: payment ? 402 : httpStatus,
        failureReason: payment?.failure_reason ?? reason,
      };
    },
  };
}
