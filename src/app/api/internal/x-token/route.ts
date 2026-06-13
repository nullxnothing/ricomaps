import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { getPool } from '@/lib/db-pool';

// Durable store for the X OAuth2 refresh token. X rotates the refresh token on
// every refresh, so the worker (which holds it only in memory) loses the live
// token on restart/redeploy and the next refresh fails with invalid_request.
// The worker loads the rotated token from here on boot and writes it back after
// each rotation. Falls back to the env-seeded token only when nothing is stored.

const KEY = 'refresh_token';
const SINCE_KEY = 'mentions_since_id';

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
    if (!pool) return NextResponse.json({ success: true, refreshToken: null, sinceId: null });
    const res = await pool.query('SELECT key, value FROM x_oauth_tokens WHERE key = ANY($1)', [[KEY, SINCE_KEY]]);
    const byKey = new Map<string, string>(res.rows.map((r: { key: string; value: string }) => [r.key, r.value]));
    return NextResponse.json({
      success: true,
      refreshToken: byKey.get(KEY) ?? null,
      // Durable high-water mark so a restart doesn't re-scan (and re-reply to)
      // mentions still inside X's recent window — the cause of duplicate replies.
      sinceId: byKey.get(SINCE_KEY) ?? null,
    });
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
  let sinceId: string | undefined;
  try {
    ({ refreshToken, sinceId } = await request.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  // Either field may be sent independently (token rotation vs. poll progress).
  if (typeof refreshToken !== 'string' && typeof sinceId !== 'string') {
    return NextResponse.json({ success: false, error: 'Nothing to persist' }, { status: 400 });
  }
  try {
    const pool = await ensureTable();
    if (!pool) return NextResponse.json({ success: true, persisted: false });
    const upsert = (key: string, value: string) => pool.query(
      `INSERT INTO x_oauth_tokens (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [key, value]
    );
    if (typeof refreshToken === 'string' && refreshToken) await upsert(KEY, refreshToken);
    if (typeof sinceId === 'string' && sinceId) await upsert(SINCE_KEY, sinceId);
    return NextResponse.json({ success: true, persisted: true });
  } catch (error) {
    console.error('[x-token] save failed:', error);
    return NextResponse.json({ success: false, error: 'Save failed' }, { status: 500 });
  }
}
