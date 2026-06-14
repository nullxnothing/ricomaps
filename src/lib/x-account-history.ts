import { getPool } from './db-pool';
import { XAccountSnapshot, XAccountIdentity } from './types';

const pool = getPool();

// Append-only X account snapshot store. Each (userId, username) pair is one row; a
// handle change adds a new row under the same immutable userId, building the username
// timeline. The recycled-account signal = >1 distinct username under one userId.
// Mirrors wallet-reputation.ts: PG-via-db-pool + in-memory fallback + ensureReady().

// key: `${userId}:${username}` — first-seen of that pair wins; later sightings bump lastSeen.
const memoryStore = new Map<string, XAccountSnapshot>();
// Handles queued for the daily tracker to resolve (seeded from token socials / scans).
const memTracked = new Map<string, number>(); // handle(lower) -> addedAt

let ready: Promise<void> | null = null;

const memKey = (userId: string, username: string) => `${userId}:${username.toLowerCase()}`;

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ============================================================================
// POSTGRES
// ============================================================================

async function initTable(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS x_account_history (
        user_id VARCHAR(32) NOT NULL,
        username VARCHAR(64) NOT NULL,
        name VARCHAR(128),
        created_at BIGINT,
        followers INTEGER,
        first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        mints JSONB NOT NULL DEFAULT '[]'::jsonb,
        PRIMARY KEY (user_id, username)
      );
      CREATE INDEX IF NOT EXISTS idx_x_acct_user ON x_account_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_x_acct_username ON x_account_history(lower(username));
      CREATE TABLE IF NOT EXISTS x_tracked_handles (
        handle VARCHAR(64) PRIMARY KEY,
        added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_resolved TIMESTAMP
      );
    `);
  } catch (error) {
    console.error('[X Account] init error:', error);
  }
}

function ensureReady(): Promise<void> {
  if (!ready) ready = initTable();
  return ready;
}

// ============================================================================
// IN-MEMORY FALLBACK
// ============================================================================

function memUpsert(snap: XAccountSnapshot): void {
  const key = memKey(snap.userId, snap.username);
  const existing = memoryStore.get(key);
  if (!existing) {
    memoryStore.set(key, { ...snap, mints: uniq(snap.mints ?? []) });
    return;
  }
  // seenAt tracks the LATEST sighting of this (id, handle) pair; foldIdentity derives
  // first/last seen across the whole id from these per-row timestamps.
  existing.seenAt = Math.max(existing.seenAt, snap.seenAt);
  existing.name = snap.name ?? existing.name;
  existing.followers = snap.followers ?? existing.followers;
  existing.createdAt = snap.createdAt ?? existing.createdAt;
  existing.mints = uniq([...(existing.mints ?? []), ...(snap.mints ?? [])]);
}

function memByUserId(userId: string): XAccountSnapshot[] {
  return [...memoryStore.values()].filter((s) => s.userId === userId);
}

function memByUsername(username: string): XAccountSnapshot[] {
  const lower = username.toLowerCase();
  return [...memoryStore.values()].filter((s) => s.username.toLowerCase() === lower);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/** Record a snapshot of an X account. Fire-and-forget at the call site. */
export async function recordXSnapshot(snap: XAccountSnapshot): Promise<void> {
  memUpsert(snap);
  if (!pool) return;
  try {
    await ensureReady();
    await pool.query(
      `INSERT INTO x_account_history (user_id, username, name, created_at, followers, first_seen, last_seen, mints)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($6), $7)
       ON CONFLICT (user_id, username) DO UPDATE SET
         name = COALESCE($3, x_account_history.name),
         created_at = COALESCE($4, x_account_history.created_at),
         followers = COALESCE($5, x_account_history.followers),
         last_seen = GREATEST(x_account_history.last_seen, to_timestamp($6)),
         mints = (
           SELECT jsonb_agg(DISTINCT elem) FROM (
             SELECT jsonb_array_elements(x_account_history.mints) AS elem
             UNION ALL SELECT jsonb_array_elements($7::jsonb) AS elem
           ) s
         )`,
      [
        snap.userId,
        snap.username,
        snap.name ?? null,
        snap.createdAt ?? null,
        snap.followers ?? null,
        snap.seenAt,
        JSON.stringify(uniq(snap.mints ?? [])),
      ],
    );
  } catch (error) {
    console.error('[X Account] record error:', error);
  }
}

/** Fold a set of snapshots (all same userId) into the resolved identity view. */
function foldIdentity(snaps: XAccountSnapshot[]): XAccountIdentity | null {
  if (snaps.length === 0) return null;
  const byRecency = [...snaps].sort((a, b) => b.seenAt - a.seenAt);
  const current = byRecency[0];
  const usernames = uniq(snaps.map((s) => s.username));
  const prior = usernames.filter((u) => u.toLowerCase() !== current.username.toLowerCase());
  return {
    userId: current.userId,
    currentUsername: current.username,
    priorUsernames: prior,
    isRecycled: usernames.length > 1,
    createdAt: snaps.find((s) => s.createdAt)?.createdAt,
    followers: current.followers,
    firstSeen: Math.min(...snaps.map((s) => s.seenAt)),
    lastSeen: Math.max(...snaps.map((s) => s.seenAt)),
    linkedMints: uniq(snaps.flatMap((s) => s.mints ?? [])),
  };
}

async function snapshotsForUserId(userId: string): Promise<XAccountSnapshot[]> {
  if (!pool) return memByUserId(userId);
  try {
    await ensureReady();
    const { rows } = await pool.query(
      `SELECT user_id, username, name, created_at, followers, mints,
              EXTRACT(EPOCH FROM first_seen)::bigint AS first_seen_ts,
              EXTRACT(EPOCH FROM last_seen)::bigint AS last_seen_ts
       FROM x_account_history WHERE user_id = $1`,
      [userId],
    );
    return rows.map(rowToSnapshot);
  } catch (error) {
    console.error('[X Account] byUserId error:', error);
    return memByUserId(userId);
  }
}

function rowToSnapshot(row: Record<string, unknown>): XAccountSnapshot {
  return {
    userId: row.user_id as string,
    username: row.username as string,
    name: (row.name as string) ?? undefined,
    createdAt: row.created_at != null ? Number(row.created_at) : undefined,
    followers: row.followers != null ? Number(row.followers) : undefined,
    seenAt: Number(row.last_seen_ts),
    mints: (row.mints as string[]) ?? [],
  };
}

/** Resolve a handle to its cross-time identity. Looks up the userId behind it first. */
export async function getXIdentityByUsername(username: string): Promise<XAccountIdentity | null> {
  let userId: string | null = null;
  if (!pool) {
    userId = memByUsername(username)[0]?.userId ?? null;
  } else {
    try {
      await ensureReady();
      const { rows } = await pool.query(
        `SELECT user_id FROM x_account_history WHERE lower(username) = lower($1) ORDER BY last_seen DESC LIMIT 1`,
        [username],
      );
      userId = rows[0]?.user_id ?? null;
    } catch (error) {
      console.error('[X Account] byUsername error:', error);
      userId = memByUsername(username)[0]?.userId ?? null;
    }
  }
  if (!userId) return null;
  return foldIdentity(await snapshotsForUserId(userId));
}

/** Resolve directly by immutable user id (when the tracker already has it). */
export async function getXIdentityByUserId(userId: string): Promise<XAccountIdentity | null> {
  return foldIdentity(await snapshotsForUserId(userId));
}

// ============================================================================
// TRACKED HANDLES: the seed queue the daily worker resolves
// ============================================================================

/** Normalize a raw handle / URL to a bare lowercase username, or null. */
export function normalizeHandle(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let v = raw.trim();
  const urlMatch = v.match(/(?:twitter|x)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i);
  if (urlMatch) v = urlMatch[1];
  v = v.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(v)) return null;
  // Skip obvious non-account paths.
  if (/^(home|search|intent|share|i|hashtag)$/i.test(v)) return null;
  return v.toLowerCase();
}

/** Queue one or more handles for tracking. Idempotent. */
export async function trackHandles(handles: string[]): Promise<void> {
  const normalized = uniq(handles.map(normalizeHandle).filter((h): h is string => !!h));
  if (normalized.length === 0) return;
  const now = Math.floor(Date.now() / 1000);
  for (const h of normalized) if (!memTracked.has(h)) memTracked.set(h, now);

  if (!pool) return;
  try {
    await ensureReady();
    for (const h of normalized) {
      await pool.query(
        `INSERT INTO x_tracked_handles (handle) VALUES ($1) ON CONFLICT (handle) DO NOTHING`,
        [h],
      );
    }
  } catch (error) {
    console.error('[X Account] trackHandles error:', error);
  }
}

/** The handles the daily worker should resolve, least-recently-resolved first. */
export async function getTrackedHandles(limit = 100): Promise<string[]> {
  if (!pool) return [...memTracked.keys()].slice(0, limit);
  try {
    await ensureReady();
    const { rows } = await pool.query(
      `SELECT handle FROM x_tracked_handles
       ORDER BY last_resolved ASC NULLS FIRST, added_at ASC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.handle as string);
  } catch (error) {
    console.error('[X Account] getTrackedHandles error:', error);
    return [...memTracked.keys()].slice(0, limit);
  }
}

/** Mark handles as resolved this cycle so the queue rotates fairly. */
export async function markHandlesResolved(handles: string[]): Promise<void> {
  if (!pool || handles.length === 0) return;
  try {
    await ensureReady();
    await pool.query(
      `UPDATE x_tracked_handles SET last_resolved = CURRENT_TIMESTAMP WHERE handle = ANY($1)`,
      [handles.map((h) => h.toLowerCase())],
    );
  } catch (error) {
    console.error('[X Account] markHandlesResolved error:', error);
  }
}

ensureReady().catch(console.error);
