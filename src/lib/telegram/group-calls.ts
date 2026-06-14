import 'server-only';
import { getPool } from '@/lib/db-pool';
import { fetchMarketDataBatch } from '@/lib/dexscreener';

const pool = getPool();

// A "call" is the FIRST time a user posts a given token CA in a given group. The
// leaderboard ranks callers by how those calls performed (market cap at call vs now).
// Mirrors telegram/subscriptions.ts: PG with an in-memory fallback so dev/no-PG works.

export interface GroupCall {
  chatId: number;
  userId: number;
  username: string;          // display handle, best-effort (may be a first name)
  mint: string;
  calledAt: number;          // unix seconds
  marketCapAtCall: number;   // USD; 0 when unknown at call time
}

// Per-group call cap so one spammy group can't grow the table without bound.
const MAX_CALLS_PER_CHAT = 5000;

// ============================================================================
// IN-MEMORY FALLBACK
// ============================================================================
const memCalls = new Map<string, GroupCall>(); // key: `${chatId}:${mint}` (first call wins)

const memKey = (chatId: number, mint: string) => `${chatId}:${mint}`;

// ============================================================================
// POSTGRES
// ============================================================================
let ready: Promise<void> | null = null;

async function initTable(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_calls (
        chat_id BIGINT NOT NULL,
        mint VARCHAR(64) NOT NULL,
        user_id BIGINT NOT NULL,
        username VARCHAR(128) NOT NULL DEFAULT '',
        called_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        market_cap_at_call DOUBLE PRECISION NOT NULL DEFAULT 0,
        PRIMARY KEY (chat_id, mint)
      );
      CREATE INDEX IF NOT EXISTS idx_group_calls_chat ON group_calls(chat_id, called_at DESC);
    `);
  } catch (error) {
    console.error('[Group Calls] init error:', error);
  }
}

function ensureReady(): Promise<void> {
  if (!ready) ready = initTable();
  return ready;
}

/**
 * Record a call. First caller of a CA in a chat wins — ON CONFLICT DO NOTHING means
 * a later poster of the same token doesn't overwrite or get credit. Returns true if
 * this was a NEW call (so the caller can optionally react), false if already called.
 */
export async function recordCall(call: Omit<GroupCall, 'calledAt'>): Promise<boolean> {
  const key = memKey(call.chatId, call.mint);
  const isNew = !memCalls.has(key);
  if (isNew) memCalls.set(key, { ...call, calledAt: Math.floor(Date.now() / 1000) });

  if (!pool) return isNew;
  try {
    await ensureReady();
    const { rowCount } = await pool.query(
      `INSERT INTO group_calls (chat_id, mint, user_id, username, market_cap_at_call)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (chat_id, mint) DO NOTHING`,
      [call.chatId, call.mint, call.userId, call.username.slice(0, 128), call.marketCapAtCall],
    );
    return (rowCount ?? 0) > 0;
  } catch (error) {
    console.error('[Group Calls] record error:', error);
    return isNew;
  }
}

/** All calls in a chat (newest first), bounded. Leaderboard re-prices these live. */
export async function listCalls(chatId: number, limit = MAX_CALLS_PER_CHAT): Promise<GroupCall[]> {
  if (!pool) {
    return [...memCalls.values()]
      .filter((c) => c.chatId === chatId)
      .sort((a, b) => b.calledAt - a.calledAt)
      .slice(0, limit);
  }
  try {
    await ensureReady();
    const { rows } = await pool.query(
      `SELECT chat_id, mint, user_id, username, market_cap_at_call,
              EXTRACT(EPOCH FROM called_at)::bigint AS called_ts
       FROM group_calls WHERE chat_id = $1 ORDER BY called_at DESC LIMIT $2`,
      [chatId, limit],
    );
    return rows.map((r) => ({
      chatId: Number(r.chat_id),
      userId: Number(r.user_id),
      username: r.username as string,
      mint: r.mint as string,
      calledAt: Number(r.called_ts),
      marketCapAtCall: Number(r.market_cap_at_call),
    }));
  } catch (error) {
    console.error('[Group Calls] list error:', error);
    return [];
  }
}

// ============================================================================
// LEADERBOARD: re-price each call live and rank callers by realized performance
// ============================================================================

export interface LeaderboardEntry {
  userId: number;
  username: string;
  calls: number;            // total calls credited to this user (in window)
  bestMultiple: number;     // best single call's MC-now / MC-at-call
  avgMultiple: number;      // mean multiple across priced calls
  hitRate: number;          // % of priced calls that reached >= 2x
}

const WIN_DAYS = { all: Infinity, '30d': 30, '7d': 7, '24h': 1 } as const;
export type LeaderboardWindow = keyof typeof WIN_DAYS;

/**
 * Build a ranked leaderboard for a chat. Pulls current market caps for every called
 * mint in one batched DexScreener call, computes each call's multiple (MC now ÷ MC at
 * call), then aggregates per caller. Calls with no price data on either side are
 * skipped from multiples but still counted toward `calls`.
 */
export async function buildLeaderboard(chatId: number, window: LeaderboardWindow = 'all'): Promise<LeaderboardEntry[]> {
  const calls = await listCalls(chatId);
  if (calls.length === 0) return [];

  const cutoff = Math.floor(Date.now() / 1000) - WIN_DAYS[window] * 86_400;
  const inWindow = window === 'all' ? calls : calls.filter((c) => c.calledAt >= cutoff);
  if (inWindow.length === 0) return [];

  const mints = [...new Set(inWindow.map((c) => c.mint))];
  const market = await fetchMarketDataBatch(mints);

  // Aggregate per user.
  const byUser = new Map<number, { username: string; calls: number; multiples: number[] }>();
  for (const call of inWindow) {
    const agg = byUser.get(call.userId) ?? { username: call.username, calls: 0, multiples: [] };
    agg.calls += 1;
    if (call.username) agg.username = call.username; // keep the freshest handle
    const mcNow = market.get(call.mint)?.marketCapUsd;
    if (mcNow && mcNow > 0 && call.marketCapAtCall > 0) {
      agg.multiples.push(mcNow / call.marketCapAtCall);
    }
    byUser.set(call.userId, agg);
  }

  const entries: LeaderboardEntry[] = [];
  for (const [userId, agg] of byUser) {
    const m = agg.multiples;
    const bestMultiple = m.length ? Math.max(...m) : 0;
    const avgMultiple = m.length ? m.reduce((s, x) => s + x, 0) / m.length : 0;
    const hitRate = m.length ? (m.filter((x) => x >= 2).length / m.length) * 100 : 0;
    entries.push({ userId, username: agg.username, calls: agg.calls, bestMultiple, avgMultiple, hitRate });
  }

  // Rank by best single call, then average — rewards finding the big one.
  return entries.sort((a, b) => b.bestMultiple - a.bestMultiple || b.avgMultiple - a.avgMultiple);
}

ensureReady().catch(console.error);
