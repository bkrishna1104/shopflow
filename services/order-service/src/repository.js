const COLUMNS = 'id, user_id, product_id, quantity, total_paise, status, payment_id, created_at, updated_at';

export function createOrderRepository(db) {
  return {
    async create({ userId, productId, quantity, totalPaise }) {
      const { rows } = await db.query(
        `INSERT INTO orders (user_id, product_id, quantity, total_paise, status)
         VALUES ($1, $2, $3, $4, 'PENDING') RETURNING ${COLUMNS}`,
        [userId, productId, quantity, totalPaise],
      );
      return rows[0];
    },

    async updateStatus(id, status, paymentId) {
      const { rows } = await db.query(
        `UPDATE orders SET status = $2, payment_id = $3, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, status, paymentId],
      );
      return rows[0];
    },

    async findById(id) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM orders WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async list({ userId, limit, offset }) {
      const { rows } = userId
        ? await db.query(`SELECT ${COLUMNS} FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT $2 OFFSET $3`, [userId, limit, offset])
        : await db.query(`SELECT ${COLUMNS} FROM orders ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return rows;
    },
  };
}
