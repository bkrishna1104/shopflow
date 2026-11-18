// PostgreSQL connection pool.
// WHY a pool: opening a DB connection costs ~20-50 ms. A pool keeps a few open
// and reuses them. DB_POOL_MAX matters in K8s: 5 pods x 10 = 50 connections.
import pg from 'pg';

export function createPool(dbConfig, logger) {
  const pool = new pg.Pool({
    ...dbConfig,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  // Without this handler an idle-connection error would crash the process.
  pool.on('error', (err) => logger.error({ err }, 'unexpected idle PostgreSQL client error'));
  return pool;
}

export function dbConfigFromEnv(env = process.env) {
  return {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: Number(env.DB_POOL_MAX ?? 10),
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}
