const COLUMNS = 'id, order_id, user_id, amount_paise, status, failure_reason, created_at';

export function createPaymentRepository(db) {
  const findByOrderId = async (orderId) => {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM payments WHERE order_id = $1`, [orderId]);
    return rows[0] ?? null;
  };

  return {
    findByOrderId,

    // Returns { payment, created }. If two identical requests race, the UNIQUE
    // constraint on order_id lets only one INSERT win; the loser returns the winner's row.
    async create({ orderId, userId, amountPaise, status, failureReason }) {
      try {
        const { rows } = await db.query(
          `INSERT INTO payments (order_id, user_id, amount_paise, status, failure_reason)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
          [orderId, userId, amountPaise, status, failureReason],
        );
        return { payment: rows[0], created: true };
      } catch (err) {
        if (err.code === '23505') return { payment: await findByOrderId(orderId), created: false };
        throw err;
      }
    },

    async findById(id) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM payments WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async list({ limit, offset }) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM payments ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return rows;
    },
  };
}
