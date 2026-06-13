import crypto from 'crypto';
import { getPool } from './db-pool';
import { CabalFingerprint, CabalFingerprintComponents, CabalTokenHistory } from './types';

const pool = getPool();

// In-memory fallback when no DATABASE_URL (dev mode), mirrors db-blacklist.ts.
const memoryStore = new Map<string, CabalFingerprint>();

// ============================================================================
// PURE HELPERS: fingerprint derivation (wallet-agnostic on purpose)
// ============================================================================

/**
 * Stable id keyed on FUNDING SOURCE + TOPOLOGY, never the raw wallet set, so the
 * same crew collides to one id even after they rotate their buy wallets.
 */
export function computeFingerprintId(c: CabalFingerprintComponents): string {
  const basis = [
    [...c.funderAddresses].sort().join(','),
    c.funderCategory ?? 'unknown',
    String(c.fanoutDepth),
    c.branchingBucket,
    c.walletAgeBucket,
  ].join('|');
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

function branchingBucket(maxWidth: number): string {
  if (maxWidth >= 13) return '13+';
  if (maxWidth >= 7) return '7-12';
  if (maxWidth >= 4) return '4-6';
  return '2-3';
}

function walletAgeBucket(agesDays: (number | undefined)[]): string {
  const known = agesDays.filter((a): a is number => a !== undefined);
  if (known.length === 0) return 'mixed';
  const freshShare = known.filter(a => a < 7).length / known.length;
  if (freshShare >= 0.7) return 'fresh';
  if (freshShare >= 0.3) return 'mixed';
  return 'aged';
}

/** Coarse source class from identity category + funder-route flags. */
function coarseFunderCategory(
  categories: (string | null | undefined)[],
  flags: { viaMixer?: boolean; viaBridge?: boolean },
): string {
  if (flags.viaMixer) return 'mixer';
  for (const cat of categories) {
    const lower = (cat ?? '').toLowerCase();
    if (lower.includes('bridge')) return 'bridge';
    if (lower.includes('exchange') || lower.includes('cex')) return 'exchange';
  }
  if (flags.viaBridge) return 'bridge';
  return 'unknown';
}

export function deriveFingerprintComponents(input: {
  sharedFunders: string[];
  funderCategories: Map<string, string | null>;
  fanoutWidths: number[];               // fundedCount per shared funder
  walletAgesDays: (number | undefined)[];
  viaMixer?: boolean;
  viaBridge?: boolean;
  laundered?: boolean;                  // behavioral-only cluster with no shared funder (Phase 4 feedback)
}): CabalFingerprintComponents {
  const funderAddresses = [...new Set(input.sharedFunders)].sort();
  const maxWidth = input.fanoutWidths.length ? Math.max(...input.fanoutWidths) : 0;
  return {
    funderAddresses,
    funderCategory: input.laundered
      ? 'laundered'
      : coarseFunderCategory([...input.funderCategories.values()], { viaMixer: input.viaMixer, viaBridge: input.viaBridge }),
    fanoutDepth: funderAddresses.length > 0 ? 1 : 0,
    branchingBucket: branchingBucket(maxWidth),
    walletAgeBucket: walletAgeBucket(input.walletAgesDays),
  };
}

// ============================================================================
// IN-MEMORY FALLBACK OPERATIONS
// ============================================================================

function mergeHistory(existing: CabalTokenHistory[], incoming: CabalTokenHistory[]): CabalTokenHistory[] {
  const byMint = new Map(existing.map(t => [t.mint, t]));
  for (const t of incoming) {
    if (!byMint.has(t.mint)) byMint.set(t.mint, t);
  }
  return [...byMint.values()];
}

function memUpsert(fp: CabalFingerprint): void {
  const existing = memoryStore.get(fp.id);
  if (!existing) {
    memoryStore.set(fp.id, { ...fp, knownWallets: [...new Set(fp.knownWallets)] });
    return;
  }
  existing.tokens = mergeHistory(existing.tokens, fp.tokens);
  existing.totalAppearances = existing.tokens.length;
  existing.knownWallets = [...new Set([...existing.knownWallets, ...fp.knownWallets])];
  existing.lastSeen = Math.max(existing.lastSeen, fp.lastSeen);
  existing.firstSeen = Math.min(existing.firstSeen, fp.firstSeen);
  // Cross-token confidence boost: a crew that resurfaces is more certainly a crew.
  existing.confidence = Math.min(100, Math.max(existing.confidence, fp.confidence) + 10 * (existing.totalAppearances - 1));
}

function memFindMatches(id: string, funderAddresses: string[]): CabalFingerprint[] {
  const out = new Map<string, CabalFingerprint>();
  const exact = memoryStore.get(id);
  if (exact) out.set(exact.id, exact);
  const funderSet = new Set(funderAddresses);
  for (const fp of memoryStore.values()) {
    if (fp.components.funderAddresses.some(f => funderSet.has(f))) out.set(fp.id, fp);
  }
  out.delete(id); // matches = OTHER appearances, not the row we just upserted
  return [...out.values()].sort((a, b) => b.confidence - a.confidence);
}

// ============================================================================
// POSTGRESQL OPERATIONS
// ============================================================================

async function initFingerprintTables(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cabal_fingerprints (
        id VARCHAR(64) PRIMARY KEY,
        components JSONB NOT NULL,
        tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
        total_appearances INTEGER DEFAULT 1,
        confidence INTEGER DEFAULT 50,
        known_wallets JSONB NOT NULL DEFAULT '[]'::jsonb,
        first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_cabal_fp_confidence ON cabal_fingerprints(confidence DESC);
      CREATE INDEX IF NOT EXISTS idx_cabal_fp_last_seen ON cabal_fingerprints(last_seen DESC);
      CREATE TABLE IF NOT EXISTS cabal_fingerprint_funders (
        funder VARCHAR(64) NOT NULL,
        fingerprint_id VARCHAR(64) NOT NULL REFERENCES cabal_fingerprints(id) ON DELETE CASCADE,
        PRIMARY KEY (funder, fingerprint_id)
      );
      CREATE INDEX IF NOT EXISTS idx_cabal_fp_funder ON cabal_fingerprint_funders(funder);
    `);
  } catch (error) {
    console.error('[Cabal Fingerprint] Failed to initialize tables:', error);
  }
}

async function pgUpsert(fp: CabalFingerprint): Promise<void> {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO cabal_fingerprints (id, components, tokens, total_appearances, confidence, known_wallets, first_seen, last_seen, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), to_timestamp($8), $9)
       ON CONFLICT (id) DO UPDATE SET
         tokens = (
           SELECT jsonb_agg(elem)
           FROM (
             SELECT DISTINCT ON (e->>'mint') e AS elem
             FROM (
               SELECT jsonb_array_elements(cabal_fingerprints.tokens) AS e
               UNION ALL
               SELECT jsonb_array_elements($3::jsonb) AS e
             ) merged
           ) deduped
         ),
         total_appearances = (
           SELECT COUNT(DISTINCT elem->>'mint')
           FROM (
             SELECT jsonb_array_elements(cabal_fingerprints.tokens) AS elem
             UNION ALL
             SELECT jsonb_array_elements($3::jsonb) AS elem
           ) sub
         ),
         confidence = LEAST(100, GREATEST(cabal_fingerprints.confidence, $5)
           + 10 * GREATEST(0, (
             SELECT COUNT(DISTINCT elem->>'mint') FROM (
               SELECT jsonb_array_elements(cabal_fingerprints.tokens) AS elem
               UNION ALL SELECT jsonb_array_elements($3::jsonb) AS elem
             ) s
           ) - 1)),
         known_wallets = (
           SELECT jsonb_agg(DISTINCT elem)
           FROM (
             SELECT jsonb_array_elements(cabal_fingerprints.known_wallets) AS elem
             UNION ALL
             SELECT jsonb_array_elements($6::jsonb) AS elem
           ) sub
         ),
         first_seen = LEAST(cabal_fingerprints.first_seen, to_timestamp($7)),
         last_seen = GREATEST(cabal_fingerprints.last_seen, to_timestamp($8)),
         metadata = COALESCE($9, cabal_fingerprints.metadata)`,
      [
        fp.id,
        JSON.stringify(fp.components),
        JSON.stringify(fp.tokens),
        fp.totalAppearances,
        fp.confidence,
        JSON.stringify([...new Set(fp.knownWallets)]),
        fp.firstSeen,
        fp.lastSeen,
        fp.metadata ? JSON.stringify(fp.metadata) : null,
      ]
    );
    for (const funder of fp.components.funderAddresses) {
      await client.query(
        `INSERT INTO cabal_fingerprint_funders (funder, fingerprint_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [funder, fp.id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function rowToFingerprint(row: Record<string, unknown>): CabalFingerprint {
  return {
    id: row.id as string,
    components: row.components as CabalFingerprintComponents,
    tokens: (row.tokens as CabalTokenHistory[]) || [],
    totalAppearances: Number(row.total_appearances),
    confidence: Number(row.confidence),
    knownWallets: (row.known_wallets as string[]) || [],
    firstSeen: Number(row.first_seen_ts),
    lastSeen: Number(row.last_seen_ts),
    metadata: (row.metadata as CabalFingerprint['metadata']) ?? undefined,
  };
}

// ============================================================================
// PUBLIC API: routes to PG or in-memory automatically
// ============================================================================

export async function upsertCabalFingerprint(fp: CabalFingerprint): Promise<void> {
  memUpsert(fp);
  if (pool) {
    try {
      await pgUpsert(fp);
    } catch (error) {
      console.error('[Cabal Fingerprint] PG upsert error:', error);
    }
  }
}

/** Other appearances of this crew: exact id match + fuzzy shared-funder overlap (rotated funder). */
export async function findMatchingCabals(id: string, funderAddresses: string[]): Promise<CabalFingerprint[]> {
  if (!pool) return memFindMatches(id, funderAddresses);

  try {
    const out = new Map<string, CabalFingerprint>();

    const exact = await pool.query(
      `SELECT id, components, tokens, total_appearances, confidence, known_wallets,
              EXTRACT(EPOCH FROM first_seen)::bigint AS first_seen_ts,
              EXTRACT(EPOCH FROM last_seen)::bigint AS last_seen_ts, metadata
       FROM cabal_fingerprints WHERE id = $1`,
      [id]
    );
    for (const row of exact.rows) out.set(row.id, rowToFingerprint(row));

    if (funderAddresses.length > 0) {
      const placeholders = funderAddresses.map((_, i) => `$${i + 1}`).join(',');
      const fuzzy = await pool.query(
        `SELECT DISTINCT fp.id, fp.components, fp.tokens, fp.total_appearances, fp.confidence, fp.known_wallets,
                EXTRACT(EPOCH FROM fp.first_seen)::bigint AS first_seen_ts,
                EXTRACT(EPOCH FROM fp.last_seen)::bigint AS last_seen_ts, fp.metadata
         FROM cabal_fingerprints fp
         JOIN cabal_fingerprint_funders f ON fp.id = f.fingerprint_id
         WHERE f.funder IN (${placeholders})`,
        funderAddresses
      );
      for (const row of fuzzy.rows) out.set(row.id, rowToFingerprint(row));
    }

    out.delete(id);
    return [...out.values()].sort((a, b) => b.confidence - a.confidence);
  } catch (error) {
    console.error('[Cabal Fingerprint] PG match error, falling back to memory:', error);
    return memFindMatches(id, funderAddresses);
  }
}

/** Fetch a single cabal fingerprint by id (atlas drill-down). */
export async function getCabalById(id: string): Promise<CabalFingerprint | null> {
  if (!pool) return memoryStore.get(id) ?? null;
  try {
    const res = await pool.query(
      `SELECT id, components, tokens, total_appearances, confidence, known_wallets,
              EXTRACT(EPOCH FROM first_seen)::bigint AS first_seen_ts,
              EXTRACT(EPOCH FROM last_seen)::bigint AS last_seen_ts, metadata
       FROM cabal_fingerprints WHERE id = $1`,
      [id]
    );
    return res.rows.length ? rowToFingerprint(res.rows[0]) : null;
  } catch (error) {
    console.error('[Cabal Fingerprint] PG getById error:', error);
    return memoryStore.get(id) ?? null;
  }
}

export async function getCabalFingerprints(
  options: { limit?: number; offset?: number; minConfidence?: number } = {}
): Promise<{ fingerprints: CabalFingerprint[]; total: number }> {
  const { limit = 20, offset = 0, minConfidence = 0 } = options;

  if (!pool) {
    const all = [...memoryStore.values()]
      .filter(f => f.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
    return { fingerprints: all.slice(offset, offset + limit), total: all.length };
  }

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM cabal_fingerprints WHERE confidence >= $1`,
      [minConfidence]
    );
    const total = parseInt(countResult.rows[0].total) || 0;
    const result = await pool.query(
      `SELECT id, components, tokens, total_appearances, confidence, known_wallets,
              EXTRACT(EPOCH FROM first_seen)::bigint AS first_seen_ts,
              EXTRACT(EPOCH FROM last_seen)::bigint AS last_seen_ts, metadata
       FROM cabal_fingerprints WHERE confidence >= $1
       ORDER BY confidence DESC LIMIT $2 OFFSET $3`,
      [minConfidence, limit, offset]
    );
    return { fingerprints: result.rows.map(rowToFingerprint), total };
  } catch (error) {
    console.error('[Cabal Fingerprint] PG list error:', error);
    return { fingerprints: [], total: 0 };
  }
}

// Initialize PG tables on module load (matches db-blacklist.ts).
initFingerprintTables().catch(console.error);
