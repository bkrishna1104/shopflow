const COLUMNS = 'id, user_id, order_id, channel, type, message, status, created_at';

export function createNotificationRepository(db) {
  return {
    async create({ userId, orderId, channel, type, message }) {
      const { rows } = await db.query(
        `INSERT INTO notifications (user_id, order_id, channel, type, message, status)
         VALUES ($1, $2, $3, $4, $5, 'SENT') RETURNING ${COLUMNS}`,
        [userId, orderId, channel, type, message],
      );
      return rows[0];
    },

    async findById(id) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM notifications WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async list({ userId, limit, offset }) {
      const { rows } = userId
        ? await db.query(`SELECT ${COLUMNS} FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`, [userId, limit, offset])
        : await db.query(`SELECT ${COLUMNS} FROM notifications ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return rows;
    },
  };
}
