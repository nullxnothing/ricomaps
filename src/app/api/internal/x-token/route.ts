import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { getPool } from '@/lib/db-pool';

// Durable store for the X OAuth2 refresh token. X rotates the refresh token on
// every refresh, so the worker (which holds it only in memory) loses the live
// token on restart/redeploy and the next refresh fails with invalid_request.
// The worker loads the rotated token from here on boot and writes it back after
// each rotation. Falls back to the env-seeded token only when nothing is stored.

const KEY = 'refresh_token';

async function ensureTable(): Promise<ReturnType<typeof getPool>> {
  const pool = getPool();
  if (!pool) return null;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS x_oauth_tokens (
      key VARCHAR(64) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return pool;
}

/** Worker loads the latest rotated refresh token on startup. */
export async function GET(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const pool = await ensureTable();
    if (!pool) return NextResponse.json({ success: true, refreshToken: null });
    const res = await pool.query('SELECT value FROM x_oauth_tokens WHERE key = $1', [KEY]);
    return NextResponse.json({ success: true, refreshToken: res.rows[0]?.value ?? null });
  } catch (error) {
    console.error('[x-token] load failed:', error);
    return NextResponse.json({ success: false, error: 'Load failed' }, { status: 500 });
  }
}

/** Worker persists the rotated refresh token after each successful refresh. */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  let refreshToken: string | undefined;
  try {
    ({ refreshToken } = await request.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!refreshToken || typeof refreshToken !== 'string') {
    return NextResponse.json({ success: false, error: 'Missing refreshToken' }, { status: 400 });
  }
  try {
    const pool = await ensureTable();
    if (!pool) return NextResponse.json({ success: true, persisted: false });
    await pool.query(
      `INSERT INTO x_oauth_tokens (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [KEY, refreshToken]
    );
    return NextResponse.json({ success: true, persisted: true });
  } catch (error) {
    console.error('[x-token] save failed:', error);
    return NextResponse.json({ success: false, error: 'Save failed' }, { status: 500 });
  }
}
