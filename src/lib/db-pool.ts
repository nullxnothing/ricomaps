import { Pool } from 'pg';

let pool: Pool | null = null;

if (!process.env.DATABASE_URL) {
  console.warn('[DB] DATABASE_URL not set: database disabled');
}

export function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;

  if (!pool) {
    // Strip sslmode from the URL and configure TLS via the ssl option instead.
    // `sslmode=require` in the connection string makes pg emit a per-connection
    // "SECURITY WARNING: SSL modes ... treated as aliases for verify-full" that
    // Vercel logged at error level on every request, drowning real errors. Neon's
    // cert chains to a public root Node trusts, so ssl:true keeps full verification.
    const connectionString = (process.env.DATABASE_URL ?? '').replace(/[?&]sslmode=[^&]*/i, '');

    pool = new Pool({
      connectionString,
      ssl: true,
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
