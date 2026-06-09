import crypto from 'crypto';
import { getPool } from './db-pool';

const pool = getPool();

export interface WatchlistEntry {
  id: string;
  userKey: string;            // ip-hash or session address; no full auth in v1
  fingerprintId?: string;     // optional link to a Phase-1 cabal fingerprint
  label: string;
  funderWallets: string[];    // wallets watched on LaserStream
  createdAt: number;          // unix seconds
}

export interface WatchlistActivity {
  id: string;
  watchlistId: string;
  funderWallet: string;
  recipients: string[];       // fresh fan-out targets
  walletCount: number;
  totalSol: number;
  threatScore: number;
  detectedAt: number;         // unix seconds
  signature: string;
  acknowledged: boolean;
}

export function generateWatchlistId(userKey: string, label: string): string {
  return crypto.createHash('sha256').update(`${userKey}:${label}:${Date.now()}`).digest('hex').slice(0, 16);
}

/** Derive a stable per-holder key from the gate-verified wallet address. */
export function userKeyForAddress(address: string): string {
  return crypto.createHash('sha256').update(`wl:${address}`).digest('hex').slice(0, 32);
}

// ============================================================================
// IN-MEMORY FALLBACK
// ============================================================================
const memWatchlists = new Map<string, WatchlistEntry>();
const memActivity = new Map<string, WatchlistActivity[]>(); // watchlistId -> activity[]

// ============================================================================
// POSTGRES
// ============================================================================
async function initWatchlistTables(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_watchlists (
        id VARCHAR(64) PRIMARY KEY,
        user_key VARCHAR(128) NOT NULL,
        fingerprint_id VARCHAR(64) REFERENCES cabal_fingerprints(id) ON DELETE SET NULL,
        label VARCHAR(256) NOT NULL,
        funder_wallets JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_watchlist_user ON user_watchlists(user_key);
      CREATE TABLE IF NOT EXISTS watchlist_activity (
        id VARCHAR(64) PRIMARY KEY,
        watchlist_id VARCHAR(64) NOT NULL REFERENCES user_watchlists(id) ON DELETE CASCADE,
        funder_wallet VARCHAR(64) NOT NULL,
        recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
        wallet_count INTEGER DEFAULT 0,
        total_sol DOUBLE PRECISION DEFAULT 0,
        threat_score INTEGER DEFAULT 0,
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        signature VARCHAR(128),
        acknowledged BOOLEAN DEFAULT FALSE
      );
      CREATE INDEX IF NOT EXISTS idx_activity_watchlist ON watchlist_activity(watchlist_id, detected_at DESC);
    `);
  } catch (error) {
    console.error('[Watchlist] Failed to initialize tables:', error);
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================
export async function createWatchlist(e: WatchlistEntry): Promise<void> {
  memWatchlists.set(e.id, e);
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO user_watchlists (id, user_key, fingerprint_id, label, funder_wallets, created_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
       ON CONFLICT (id) DO NOTHING`,
      [e.id, e.userKey, e.fingerprintId ?? null, e.label, JSON.stringify(e.funderWallets), e.createdAt]
    );
  } catch (error) {
    console.error('[Watchlist] create error:', error);
  }
}

export async function listWatchlists(userKey: string): Promise<WatchlistEntry[]> {
  if (!pool) {
    return [...memWatchlists.values()].filter(w => w.userKey === userKey).sort((a, b) => b.createdAt - a.createdAt);
  }
  try {
    const res = await pool.query(
      `SELECT id, user_key, fingerprint_id, label, funder_wallets,
              EXTRACT(EPOCH FROM created_at)::bigint AS created_ts
       FROM user_watchlists WHERE user_key = $1 ORDER BY created_at DESC`,
      [userKey]
    );
    return res.rows.map(r => ({
      id: r.id, userKey: r.user_key, fingerprintId: r.fingerprint_id ?? undefined,
      label: r.label, funderWallets: r.funder_wallets || [], createdAt: Number(r.created_ts),
    }));
  } catch (error) {
    console.error('[Watchlist] list error:', error);
    return [];
  }
}

export async function getWatchlist(id: string, userKey: string): Promise<WatchlistEntry | null> {
  if (!pool) {
    const w = memWatchlists.get(id);
    return w && w.userKey === userKey ? w : null;
  }
  try {
    const res = await pool.query(
      `SELECT id, user_key, fingerprint_id, label, funder_wallets,
              EXTRACT(EPOCH FROM created_at)::bigint AS created_ts
       FROM user_watchlists WHERE id = $1 AND user_key = $2`,
      [id, userKey]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id, userKey: r.user_key, fingerprintId: r.fingerprint_id ?? undefined,
      label: r.label, funderWallets: r.funder_wallets || [], createdAt: Number(r.created_ts),
    };
  } catch (error) {
    console.error('[Watchlist] get error:', error);
    return null;
  }
}

export async function deleteWatchlist(id: string, userKey: string): Promise<void> {
  memWatchlists.delete(id);
  memActivity.delete(id);
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM user_watchlists WHERE id = $1 AND user_key = $2`, [id, userKey]);
  } catch (error) {
    console.error('[Watchlist] delete error:', error);
  }
}

export async function recordActivity(a: WatchlistActivity): Promise<void> {
  const list = memActivity.get(a.watchlistId) ?? [];
  list.unshift(a);
  memActivity.set(a.watchlistId, list.slice(0, 100));
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO watchlist_activity (id, watchlist_id, funder_wallet, recipients, wallet_count, total_sol, threat_score, detected_at, signature, acknowledged)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8), $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.watchlistId, a.funderWallet, JSON.stringify(a.recipients), a.walletCount, a.totalSol, a.threatScore, a.detectedAt, a.signature, a.acknowledged]
    );
  } catch (error) {
    console.error('[Watchlist] record activity error:', error);
  }
}

export async function listActivity(watchlistId: string, since?: number): Promise<WatchlistActivity[]> {
  if (!pool) {
    const list = memActivity.get(watchlistId) ?? [];
    return since ? list.filter(a => a.detectedAt > since) : list;
  }
  try {
    const params: (string | number)[] = [watchlistId];
    let where = 'WHERE watchlist_id = $1';
    if (since) { params.push(since); where += ` AND detected_at > to_timestamp($2)`; }
    const res = await pool.query(
      `SELECT id, watchlist_id, funder_wallet, recipients, wallet_count, total_sol, threat_score,
              EXTRACT(EPOCH FROM detected_at)::bigint AS detected_ts, signature, acknowledged
       FROM watchlist_activity ${where} ORDER BY detected_at DESC LIMIT 100`,
      params
    );
    return res.rows.map(r => ({
      id: r.id, watchlistId: r.watchlist_id, funderWallet: r.funder_wallet,
      recipients: r.recipients || [], walletCount: r.wallet_count, totalSol: Number(r.total_sol),
      threatScore: r.threat_score, detectedAt: Number(r.detected_ts), signature: r.signature,
      acknowledged: r.acknowledged,
    }));
  } catch (error) {
    console.error('[Watchlist] list activity error:', error);
    return [];
  }
}

initWatchlistTables().catch(console.error);
