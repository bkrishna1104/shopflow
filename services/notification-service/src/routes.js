import { Router } from 'express';
import { HttpError } from './lib/errors.js';
import { positiveInt, nonEmptyString, pagination } from './lib/validate.js';

const CHANNELS = ['EMAIL', 'SMS'];

export function notificationsRouter({ repo, logger, sentCounter }) {
  const router = Router();

  // POST /notifications {user_id, order_id?, channel?, type, message}
  // A real system would call an email/SMS provider here. We simulate "sending"
  // by logging + storing, which is enough to see the end-to-end flow.
  router.post('/', async (req, res) => {
    const channel = (req.body?.channel ?? 'EMAIL').toUpperCase();
    if (!CHANNELS.includes(channel)) throw new HttpError(400, `channel must be one of ${CHANNELS.join(', ')}`);
    const notification = await repo.create({
      userId: positiveInt(req.body?.user_id, 'user_id'),
      orderId: req.body?.order_id == null ? null : positiveInt(req.body.order_id, 'order_id'),
      channel,
      type: nonEmptyString(req.body?.type, 'type', 50),
      message: nonEmptyString(req.body?.message, 'message', 1000),
    });
    sentCounter.inc({ channel, type: notification.type });
    logger.info({ notificationId: notification.id, userId: notification.user_id, channel }, 'notification sent (simulated)');
    res.status(201).location(`/notifications/${notification.id}`).json(notification);
  });

  // GET /notifications?user_id=
  router.get('/', async (req, res) => {
    const userId = req.query.user_id === undefined ? null : positiveInt(req.query.user_id, 'user_id');
    res.json(await repo.list({ userId, ...pagination(req.query) }));
  });

  router.get('/:id', async (req, res) => {
    const n = await repo.findById(positiveInt(req.params.id, 'id'));
    if (!n) throw new HttpError(404, 'notification not found');
    res.json(n);
  });

  return router;
}
