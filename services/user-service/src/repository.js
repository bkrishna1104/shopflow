// Data access layer: the ONLY file that knows SQL.
// WHY separate: routes can be unit-tested with a fake repository (no DB needed),
// and SQL changes (Phase 10 migrations) are isolated here.
import { HttpError } from './lib/errors.js';

const COLUMNS = 'id, name, email, created_at';

export function createUserRepository(db) {
  return {
    async create({ name, email }) {
      try {
        const { rows } = await db.query(
          `INSERT INTO users (name, email) VALUES ($1, $2) RETURNING ${COLUMNS}`,
          [name, email],
        );
        return rows[0];
      } catch (err) {
        // 23505 = unique_violation. Let the DB enforce uniqueness (race-safe),
        // instead of "SELECT then INSERT" which two parallel requests can beat.
        if (err.code === '23505') throw new HttpError(409, 'email is already registered');
        throw err;
      }
    },

    async findById(id) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },

    async list({ limit, offset }) {
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM users ORDER BY id LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      return rows;
    },
  };
}
