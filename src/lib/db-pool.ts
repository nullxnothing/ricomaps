import { Pool } from 'pg';

let pool: Pool | null = null;

if (!process.env.DATABASE_URL) {
  console.warn('[DB] DATABASE_URL not set — database disabled');
}

export function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on('error', (err) => {
      console.error('[DB] Pool error:', err.message);
    });
  }

  return pool;
}
