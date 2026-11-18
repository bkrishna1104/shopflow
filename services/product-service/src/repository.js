import { HttpError } from './lib/errors.js';

const COLUMNS = 'id, sku, name, price_paise, stock, created_at, updated_at';

export function createProductRepository(db) {
  return {
    async create({ sku, name, pricePaise, stock }) {
      try {
        const { rows } = await db.query(
          `INSERT INTO products (sku, name, price_paise, stock) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
          [sku, name, pricePaise, stock],
        );
        return rows[0];
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'sku already exists');
        throw err;
      }
    },

    async findById(id) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async list({ limit, offset }) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM products ORDER BY id LIMIT $1 OFFSET $2`, [limit, offset]);
      return rows;
    },

    // ATOMIC stock reservation. One UPDATE with a condition, not "SELECT stock,
    // then UPDATE": with two parallel orders for the last item, SELECT-then-UPDATE
    // sells it twice. Here Postgres row-locks and only one UPDATE matches.
    async reserve(id, quantity) {
      const { rows } = await db.query(
        `UPDATE products SET stock = stock - $2, updated_at = now()
         WHERE id = $1 AND stock >= $2 RETURNING ${COLUMNS}`,
        [id, quantity],
      );
      return rows[0] ?? null; // null = not found OR not enough stock
    },

    // Compensation: give stock back when payment fails (Saga pattern, see order-service).
    async release(id, quantity) {
      const { rows } = await db.query(
        `UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, quantity],
      );
      return rows[0] ?? null;
    },
  };
}
