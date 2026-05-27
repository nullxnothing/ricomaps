import { BundleCluster } from './types';
import { getPool } from './db-pool';
import crypto from 'crypto';

const pool = getPool();

// In-memory fallback when no DATABASE_URL (dev mode)
const memoryStore = new Map<string, BundleCluster>();

export function generateClusterId(wallets: string[]): string {
  const sorted = [...wallets].sort();
  return crypto.createHash('sha256').update(sorted.join(':')).digest('hex').slice(0, 16);
}

// ============================================================================
// IN-MEMORY FALLBACK OPERATIONS
// ============================================================================

function memUpsert(cluster: BundleCluster): void {
  const existing = memoryStore.get(cluster.id);
  if (existing) {
    // Merge token appearances (dedupe by mint)
    const existingMints = new Set(existing.tokens.map(t => t.mint));
    const newTokens = cluster.tokens.filter(t => !existingMints.has(t.mint));
    existing.tokens.push(...newTokens);
    existing.totalAppearances = existing.tokens.length;
    existing.confidence = Math.max(existing.confidence, cluster.confidence);
    existing.lastSeenTimestamp = Math.max(existing.lastSeenTimestamp, cluster.lastSeenTimestamp);
    existing.sharedFunder = cluster.sharedFunder || existing.sharedFunder;
    existing.metadata = cluster.metadata || existing.metadata;
    // Cross-token confidence boost
    if (existing.totalAppearances >= 2) {
      existing.confidence = Math.min(100, existing.confidence + 15 * (existing.totalAppearances - 1));
    }
  } else {
    memoryStore.set(cluster.id, { ...cluster });
  }
}

function memGetClusters(options: GetClustersOptions): { clusters: BundleCluster[]; total: number } {
  const { limit = 20, offset = 0, sortBy = 'confidence', sortDir = 'desc', minConfidence = 0, walletSearch } = options;

  let all = Array.from(memoryStore.values());

  if (minConfidence > 0) all = all.filter(c => c.confidence >= minConfidence);
  if (walletSearch) all = all.filter(c => c.wallets.some(w => w.includes(walletSearch)));

  // Sort
  all.sort((a, b) => {
    let va: number, vb: number;
    switch (sortBy) {
      case 'last_seen': va = a.lastSeenTimestamp; vb = b.lastSeenTimestamp; break;
      case 'total_appearances': va = a.totalAppearances; vb = b.totalAppearances; break;
      case 'wallet_count': va = a.wallets.length; vb = b.wallets.length; break;
      default: va = a.confidence; vb = b.confidence;
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  const total = all.length;
  return { clusters: all.slice(offset, offset + limit), total };
}

function memGetByWallet(wallets: string[]): BundleCluster[] {
  const walletSet = new Set(wallets);
  return Array.from(memoryStore.values())
    .filter(c => c.wallets.some(w => walletSet.has(w)))
    .sort((a, b) => b.confidence - a.confidence);
}

// ============================================================================
// POSTGRESQL OPERATIONS
// ============================================================================

async function initBlacklistTables(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bundle_clusters (
        id VARCHAR(64) PRIMARY KEY,
        wallets JSONB NOT NULL,
        tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
        total_appearances INTEGER DEFAULT 1,
        confidence INTEGER DEFAULT 50,
        shared_funder VARCHAR(64),
        first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_bundle_clusters_last_seen ON bundle_clusters(last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_bundle_clusters_confidence ON bundle_clusters(confidence DESC);
      CREATE TABLE IF NOT EXISTS bundle_wallet_index (
        wallet VARCHAR(64) NOT NULL,
        cluster_id VARCHAR(64) NOT NULL REFERENCES bundle_clusters(id) ON DELETE CASCADE,
        PRIMARY KEY (wallet, cluster_id)
      );
      CREATE INDEX IF NOT EXISTS idx_wallet_index_wallet ON bundle_wallet_index(wallet);
    `);
  } catch (error) {
    console.error('[DB Blacklist] Failed to initialize tables:', error);
  }
}

async function pgUpsert(cluster: BundleCluster): Promise<void> {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bundle_clusters (id, wallets, tokens, total_appearances, confidence, shared_funder, first_seen, last_seen, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), to_timestamp($8), $9)
       ON CONFLICT (id) DO UPDATE SET
         tokens = (
           SELECT jsonb_agg(DISTINCT elem)
           FROM (
             SELECT jsonb_array_elements(bundle_clusters.tokens) AS elem
             UNION ALL
             SELECT jsonb_array_elements($3::jsonb) AS elem
           ) sub
         ),
         total_appearances = (
           SELECT COUNT(DISTINCT elem->>'mint')
           FROM (
             SELECT jsonb_array_elements(bundle_clusters.tokens) AS elem
             UNION ALL
             SELECT jsonb_array_elements($3::jsonb) AS elem
           ) sub
         ),
         confidence = GREATEST(bundle_clusters.confidence, $5),
         shared_funder = COALESCE($6, bundle_clusters.shared_funder),
         last_seen = GREATEST(bundle_clusters.last_seen, to_timestamp($8)),
         metadata = COALESCE($9, bundle_clusters.metadata)`,
      [
        cluster.id,
        JSON.stringify(cluster.wallets),
        JSON.stringify(cluster.tokens),
        cluster.totalAppearances,
        cluster.confidence,
        cluster.sharedFunder || null,
        cluster.firstSeenTimestamp,
        cluster.lastSeenTimestamp,
        cluster.metadata ? JSON.stringify(cluster.metadata) : null,
      ]
    );
    for (const wallet of cluster.wallets) {
      await client.query(
        `INSERT INTO bundle_wallet_index (wallet, cluster_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [wallet, cluster.id]
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

// ============================================================================
// PUBLIC API — routes to PG or in-memory automatically
// ============================================================================

export async function upsertBundleCluster(cluster: BundleCluster): Promise<void> {
  // Always write to memory (fast, always available)
  memUpsert(cluster);

  // Also persist to PG if available
  if (pool) {
    try {
      await pgUpsert(cluster);
    } catch (error) {
      console.error('[DB Blacklist] PG upsert error:', error);
    }
  }
}

export async function persistBundleClusters(clusters: BundleCluster[]): Promise<void> {
  for (const cluster of clusters) {
    await upsertBundleCluster(cluster);
  }
}

type SortField = 'confidence' | 'last_seen' | 'total_appearances' | 'wallet_count';

interface GetClustersOptions {
  limit?: number;
  offset?: number;
  sortBy?: SortField;
  sortDir?: 'asc' | 'desc';
  minConfidence?: number;
  walletSearch?: string;
}

export async function getBundleClusters(options: GetClustersOptions = {}): Promise<{
  clusters: BundleCluster[];
  total: number;
}> {
  // Use PG if available, otherwise fall back to memory
  if (!pool) return memGetClusters(options);

  const { limit = 20, offset = 0, sortBy = 'confidence', sortDir = 'desc', minConfidence = 0, walletSearch } = options;

  try {
    const sortColumn = sortBy === 'wallet_count' ? 'jsonb_array_length(wallets)' : sortBy;
    const direction = sortDir === 'asc' ? 'ASC' : 'DESC';

    let whereClause = 'WHERE confidence >= $1';
    const params: (string | number)[] = [minConfidence];

    if (walletSearch) {
      params.push(walletSearch);
      whereClause += ` AND wallets::text LIKE '%' || $${params.length} || '%'`;
    }

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM bundle_clusters ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].total) || 0;

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT id, wallets, tokens, total_appearances, confidence, shared_funder,
              EXTRACT(EPOCH FROM first_seen)::bigint as first_seen_ts,
              EXTRACT(EPOCH FROM last_seen)::bigint as last_seen_ts,
              metadata
       FROM bundle_clusters ${whereClause}
       ORDER BY ${sortColumn} ${direction}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const clusters: BundleCluster[] = result.rows.map((row) => ({
      id: row.id,
      wallets: row.wallets,
      tokens: row.tokens || [],
      totalAppearances: row.total_appearances,
      lastSeenTimestamp: Number(row.last_seen_ts),
      firstSeenTimestamp: Number(row.first_seen_ts),
      confidence: row.confidence,
      sharedFunder: row.shared_funder,
      metadata: row.metadata,
    }));

    return { clusters, total };
  } catch (error) {
    console.error('[DB Blacklist] PG query error, falling back to memory:', error);
    return memGetClusters(options);
  }
}

export async function getClustersByWallet(wallets: string[]): Promise<BundleCluster[]> {
  if (wallets.length === 0) return [];

  if (!pool) return memGetByWallet(wallets);

  try {
    const placeholders = wallets.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT DISTINCT bc.id, bc.wallets, bc.tokens, bc.total_appearances, bc.confidence,
              bc.shared_funder,
              EXTRACT(EPOCH FROM bc.first_seen)::bigint as first_seen_ts,
              EXTRACT(EPOCH FROM bc.last_seen)::bigint as last_seen_ts,
              bc.metadata
       FROM bundle_clusters bc
       JOIN bundle_wallet_index bwi ON bc.id = bwi.cluster_id
       WHERE bwi.wallet IN (${placeholders})
       ORDER BY bc.confidence DESC`,
      wallets
    );

    return result.rows.map((row) => ({
      id: row.id,
      wallets: row.wallets,
      tokens: row.tokens || [],
      totalAppearances: row.total_appearances,
      lastSeenTimestamp: Number(row.last_seen_ts),
      firstSeenTimestamp: Number(row.first_seen_ts),
      confidence: row.confidence,
      sharedFunder: row.shared_funder,
      metadata: row.metadata,
    }));
  } catch (error) {
    console.error('[DB Blacklist] PG wallet lookup error, falling back to memory:', error);
    return memGetByWallet(wallets);
  }
}

export async function getAllBlacklistedWallets(): Promise<
  { wallet: string; clusterCount: number; maxConfidence: number }[]
> {
  // Memory path
  if (!pool) {
    const walletMap = new Map<string, { count: number; maxConf: number }>();
    for (const cluster of memoryStore.values()) {
      for (const wallet of cluster.wallets) {
        const existing = walletMap.get(wallet) || { count: 0, maxConf: 0 };
        existing.count++;
        existing.maxConf = Math.max(existing.maxConf, cluster.confidence);
        walletMap.set(wallet, existing);
      }
    }
    return Array.from(walletMap.entries())
      .map(([wallet, data]) => ({ wallet, clusterCount: data.count, maxConfidence: data.maxConf }))
      .sort((a, b) => b.maxConfidence - a.maxConfidence);
  }

  try {
    const result = await pool.query(
      `SELECT bwi.wallet,
              COUNT(DISTINCT bwi.cluster_id) as cluster_count,
              MAX(bc.confidence) as max_confidence
       FROM bundle_wallet_index bwi
       JOIN bundle_clusters bc ON bwi.cluster_id = bc.id
       GROUP BY bwi.wallet
       ORDER BY max_confidence DESC, cluster_count DESC`
    );
    return result.rows.map((row) => ({
      wallet: row.wallet,
      clusterCount: parseInt(row.cluster_count),
      maxConfidence: row.max_confidence,
    }));
  } catch (error) {
    console.error('[DB Blacklist] Get all wallets error:', error);
    return [];
  }
}

// Initialize PG tables on module load
initBlacklistTables().catch(console.error);
