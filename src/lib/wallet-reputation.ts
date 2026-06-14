import { getPool } from './db-pool';
import { WalletReputation, WalletReputationObservation, WalletReputationTag } from './types';

const pool = getPool();

// In-memory fallback when no DATABASE_URL (dev mode), mirrors cabal-fingerprint.ts / db-blacklist.ts.
const memoryStore = new Map<string, WalletReputation>();

// Cap stored mints per wallet so a prolific address can't grow an unbounded row.
const MAX_MINTS = 200;

// ============================================================================
// PURE HELPERS
// ============================================================================

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Fold one observation into an existing (or empty) reputation row. Pure. */
function applyObservation(prev: WalletReputation | undefined, obs: WalletReputationObservation, nowSec: number): WalletReputation {
  const base: WalletReputation = prev ?? {
    address: obs.address,
    tags: [],
    tokensSniped: 0,
    tokensBundled: 0,
    tokensDeployed: 0,
    tokensRugged: 0,
    timesSeen: 0,
    mints: [],
    firstSeen: nowSec,
    lastSeen: nowSec,
  };

  const seenMint = base.mints.includes(obs.mint);
  const tags = uniq([...base.tags, ...obs.tags]);

  // Per-token counters only increment the FIRST time we see this wallet+mint pair,
  // so re-scanning the same token never inflates the history.
  const isNewMint = !seenMint;
  const has = (t: WalletReputationTag) => obs.tags.includes(t);

  return {
    ...base,
    tags,
    tokensSniped: base.tokensSniped + (isNewMint && has('sniper') ? 1 : 0),
    tokensBundled: base.tokensBundled + (isNewMint && has('bundler') ? 1 : 0),
    tokensDeployed: base.tokensDeployed + (isNewMint && (has('serial-deployer') || has('rug-dev')) ? 1 : 0),
    tokensRugged: base.tokensRugged + (isNewMint && obs.rugged ? 1 : 0),
    timesSeen: base.timesSeen + (isNewMint ? 1 : 0),
    mints: uniq([obs.mint, ...base.mints]).slice(0, MAX_MINTS),
    firstSeen: Math.min(base.firstSeen, nowSec),
    lastSeen: Math.max(base.lastSeen, nowSec),
  };
}

// ============================================================================
// IN-MEMORY FALLBACK OPERATIONS
// ============================================================================

function memUpsert(obs: WalletReputationObservation, nowSec: number): void {
  memoryStore.set(obs.address, applyObservation(memoryStore.get(obs.address), obs, nowSec));
}

function memGet(addresses: string[]): Map<string, WalletReputation> {
  const out = new Map<string, WalletReputation>();
  for (const a of addresses) {
    const r = memoryStore.get(a);
    if (r) out.set(a, r);
  }
  return out;
}

// ============================================================================
// POSTGRESQL OPERATIONS
// ============================================================================

// Shared init promise so the FIRST upsert/read can await it — without this, a
// scan that fires before the module's on-load init resolves hits the table before
// it exists (42P01). All callers await `ready` before touching PG.
let ready: Promise<void> | null = null;

async function initReputationTables(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_reputation (
        address VARCHAR(64) PRIMARY KEY,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        tokens_sniped INTEGER NOT NULL DEFAULT 0,
        tokens_bundled INTEGER NOT NULL DEFAULT 0,
        tokens_deployed INTEGER NOT NULL DEFAULT 0,
        tokens_rugged INTEGER NOT NULL DEFAULT 0,
        times_seen INTEGER NOT NULL DEFAULT 0,
        mints JSONB NOT NULL DEFAULT '[]'::jsonb,
        first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_rep_last_seen ON wallet_reputation(last_seen DESC);
    `);
  } catch (error) {
    console.error('[Wallet Reputation] Failed to initialize tables:', error);
  }
}

/** Idempotently ensure tables exist; subsequent calls reuse the same promise. */
function ensureReady(): Promise<void> {
  if (!ready) ready = initReputationTables();
  return ready;
}

/**
 * Upsert one observation. Counters only advance when the mint is new for this
 * wallet (NOT (mints ? mint)), so re-scans are idempotent. Done in a single
 * round-trip via a read-modifying CTE — Postgres can't express the per-mint
 * dedupe inline cheaply, so we compute the delta in SQL with a jsonb membership test.
 */
async function pgUpsert(obs: WalletReputationObservation, nowSec: number): Promise<void> {
  if (!pool) return;
  const isSniper = obs.tags.includes('sniper');
  const isBundler = obs.tags.includes('bundler');
  const isDeployer = obs.tags.includes('serial-deployer') || obs.tags.includes('rug-dev');
  const isRugged = !!obs.rugged;

  await pool.query(
    `INSERT INTO wallet_reputation
       (address, tags, tokens_sniped, tokens_bundled, tokens_deployed, tokens_rugged, times_seen, mints, first_seen, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, to_timestamp($8), to_timestamp($8))
     ON CONFLICT (address) DO UPDATE SET
       tags = (
         SELECT jsonb_agg(DISTINCT elem) FROM (
           SELECT jsonb_array_elements(wallet_reputation.tags) AS elem
           UNION ALL SELECT jsonb_array_elements($2::jsonb) AS elem
         ) s
       ),
       tokens_sniped  = wallet_reputation.tokens_sniped  + (CASE WHEN $9  AND NOT (wallet_reputation.mints @> $10::jsonb) THEN 1 ELSE 0 END),
       tokens_bundled = wallet_reputation.tokens_bundled + (CASE WHEN $11 AND NOT (wallet_reputation.mints @> $10::jsonb) THEN 1 ELSE 0 END),
       tokens_deployed= wallet_reputation.tokens_deployed+ (CASE WHEN $12 AND NOT (wallet_reputation.mints @> $10::jsonb) THEN 1 ELSE 0 END),
       tokens_rugged  = wallet_reputation.tokens_rugged  + (CASE WHEN $13 AND NOT (wallet_reputation.mints @> $10::jsonb) THEN 1 ELSE 0 END),
       times_seen     = wallet_reputation.times_seen     + (CASE WHEN     NOT (wallet_reputation.mints @> $10::jsonb) THEN 1 ELSE 0 END),
       mints = (
         SELECT jsonb_agg(elem) FROM (
           SELECT DISTINCT elem FROM (
             SELECT jsonb_array_elements($7::jsonb) AS elem
             UNION ALL SELECT jsonb_array_elements(wallet_reputation.mints) AS elem
           ) u LIMIT ${MAX_MINTS}
         ) capped
       ),
       last_seen = GREATEST(wallet_reputation.last_seen, to_timestamp($8))`,
    [
      obs.address,                       // $1
      JSON.stringify(uniq(obs.tags)),    // $2
      isSniper ? 1 : 0,                  // $3 (insert-time counters)
      isBundler ? 1 : 0,                 // $4
      isDeployer ? 1 : 0,                // $5
      isRugged ? 1 : 0,                  // $6
      JSON.stringify([obs.mint]),        // $7
      nowSec,                            // $8
      isSniper,                          // $9
      JSON.stringify(obs.mint),          // $10 (scalar for @> membership test)
      isBundler,                         // $11
      isDeployer,                        // $12
      isRugged,                          // $13
    ]
  );
}

function rowToReputation(row: Record<string, unknown>): WalletReputation {
  return {
    address: row.address as string,
    tags: (row.tags as WalletReputationTag[]) || [],
    tokensSniped: Number(row.tokens_sniped),
    tokensBundled: Number(row.tokens_bundled),
    tokensDeployed: Number(row.tokens_deployed),
    tokensRugged: Number(row.tokens_rugged),
    timesSeen: Number(row.times_seen),
    mints: (row.mints as string[]) || [],
    firstSeen: Number(row.first_seen_ts),
    lastSeen: Number(row.last_seen_ts),
  };
}

// ============================================================================
// PUBLIC API: routes to PG or in-memory automatically
// ============================================================================

/**
 * Record a batch of observations from a single scan. Fire-and-forget at the call
 * site (same pattern as upsertCabalFingerprint) — never blocks or fails a scan.
 */
export async function recordWalletReputations(observations: WalletReputationObservation[]): Promise<void> {
  if (observations.length === 0) return;
  const nowSec = Math.floor(Date.now() / 1000);

  // Always keep the in-memory mirror warm so reads work even if PG hiccups.
  for (const obs of observations) memUpsert(obs, nowSec);

  if (!pool) return;
  try {
    await ensureReady();
    for (const obs of observations) await pgUpsert(obs, nowSec);
  } catch (error) {
    console.error('[Wallet Reputation] PG upsert error:', error);
  }
}

/** Batch-fetch stored reputation for a set of addresses (read-back on each scan). */
export async function getWalletReputations(addresses: string[]): Promise<Map<string, WalletReputation>> {
  const unique = uniq(addresses);
  if (unique.length === 0) return new Map();
  if (!pool) return memGet(unique);

  try {
    await ensureReady();
    const placeholders = unique.map((_, i) => `$${i + 1}`).join(',');
    const res = await pool.query(
      `SELECT address, tags, tokens_sniped, tokens_bundled, tokens_deployed, tokens_rugged, times_seen, mints,
              EXTRACT(EPOCH FROM first_seen)::bigint AS first_seen_ts,
              EXTRACT(EPOCH FROM last_seen)::bigint AS last_seen_ts
       FROM wallet_reputation WHERE address IN (${placeholders})`,
      unique
    );
    const out = new Map<string, WalletReputation>();
    for (const row of res.rows) out.set(row.address as string, rowToReputation(row));
    return out;
  } catch (error) {
    console.error('[Wallet Reputation] PG fetch error, falling back to memory:', error);
    return memGet(unique);
  }
}

/**
 * Build the human-readable rap-sheet tags merged onto identity.tags. Only emits a
 * tag when the cross-token history is meaningful (seen in >1 token), so a single
 * scan doesn't brand a wallet — that's what makes this stronger than a per-scan flag.
 */
export function reputationToTags(rep: WalletReputation): string[] {
  const tags: string[] = [];
  if (rep.tokensSniped > 1) tags.push(`serial-sniper:${rep.tokensSniped}`);
  if (rep.tokensBundled > 1) tags.push(`serial-bundler:${rep.tokensBundled}`);
  if (rep.tags.includes('rug-dev') || rep.tokensRugged > 0) tags.push('rug-dev');
  else if (rep.tokensDeployed > 1) tags.push(`serial-deployer:${rep.tokensDeployed}`);
  return tags;
}

// Kick off table init on module load (matches cabal-fingerprint.ts / db-blacklist.ts),
// but callers also await ensureReady() so the first scan can't race the CREATE TABLE.
ensureReady().catch(console.error);
