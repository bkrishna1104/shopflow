import { Router } from 'express';
import { HttpError } from './lib/errors.js';
import { positiveInt, pagination } from './lib/validate.js';

export function ordersRouter({ repo, workflow }) {
  const router = Router();

  // POST /orders {user_id, product_id, quantity}
  //  201 PAID | 402 payment declined | 409 out of stock | 422 unknown user/product
  //  502/503 a downstream service failed
  router.post('/', async (req, res) => {
    const { order, httpStatus, failureReason } = await workflow.placeOrder({
      userId: positiveInt(req.body?.user_id, 'user_id'),
      productId: positiveInt(req.body?.product_id, 'product_id'),
      quantity: positiveInt(req.body?.quantity ?? 1, 'quantity'),
    });
    res.status(httpStatus).location(`/orders/${order.id}`)
      .json(failureReason ? { ...order, failure_reason: failureReason } : order);
  });

  router.get('/', async (req, res) => {
    const userId = req.query.user_id === undefined ? null : positiveInt(req.query.user_id, 'user_id');
    res.json(await repo.list({ userId, ...pagination(req.query) }));
  });

  router.get('/:id', async (req, res) => {
    const order = await repo.findById(positiveInt(req.params.id, 'id'));
    if (!order) throw new HttpError(404, 'order not found');
    res.json(order);
  });

  return router;
}
