import { Pool } from 'pg';
import { GraphData, TokenSecurityInfo, TokenMetadata } from './types';

// PostgreSQL connection using Railway
if (!process.env.DATABASE_URL) {
  console.warn('[DB Cache] DATABASE_URL not set — caching disabled');
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

pool?.on('error', (err) => {
  console.error('[DB Cache] Pool error:', err.message);
});

// Cache TTL: 2 hours for token scans
const CACHE_TTL_SECONDS = 2 * 60 * 60;

interface CachedTokenScan {
  address: string;
  data: GraphData;
  stats: Record<string, unknown>;
  tokenSecurity: TokenSecurityInfo | null;
  tokenMetadata: TokenMetadata | null;
  createdAt: Date;
}

/**
 * Initialize the cache table if it doesn't exist
 */
export async function initCacheTable(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS token_scan_cache (
        address VARCHAR(64) PRIMARY KEY,
        data JSONB NOT NULL,
        stats JSONB,
        token_security JSONB,
        token_metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_token_cache_expires ON token_scan_cache(expires_at);
    `);
    console.log('[DB Cache] Table initialized');
  } catch (error) {
    console.error('[DB Cache] Failed to initialize table:', error);
  }
}

/**
 * Get cached token scan result
 */
export async function getCachedTokenScan(address: string): Promise<CachedTokenScan | null> {
  if (!pool) return null;
  try {
    const result = await pool.query(
      `SELECT data, stats, token_security, token_metadata, created_at
       FROM token_scan_cache
       WHERE address = $1 AND expires_at > NOW()`,
      [address]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    console.log(`[DB Cache] HIT for ${address.slice(0, 8)}...`);

    return {
      address,
      data: row.data,
      stats: row.stats || {},
      tokenSecurity: row.token_security,
      tokenMetadata: row.token_metadata,
      createdAt: row.created_at,
    };
  } catch (error) {
    console.error('[DB Cache] Get error:', error);
    return null;
  }
}

/**
 * Store token scan result in cache
 */
export async function setCachedTokenScan(
  address: string,
  data: GraphData,
  stats: Record<string, unknown>,
  tokenSecurity: TokenSecurityInfo | null,
  tokenMetadata: TokenMetadata | null
): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO token_scan_cache (address, data, stats, token_security, token_metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6))
       ON CONFLICT (address)
       DO UPDATE SET
         data = $2,
         stats = $3,
         token_security = $4,
         token_metadata = $5,
         created_at = CURRENT_TIMESTAMP,
         expires_at = NOW() + make_interval(secs => $6)`,
      [address, JSON.stringify(data), JSON.stringify(stats), JSON.stringify(tokenSecurity), JSON.stringify(tokenMetadata), CACHE_TTL_SECONDS]
    );
    console.log(`[DB Cache] Stored ${address.slice(0, 8)}...`);
  } catch (error) {
    console.error('[DB Cache] Set error:', error);
  }
}

/**
 * Clean up expired cache entries
 */
export async function cleanupExpiredCache(): Promise<number> {
  if (!pool) return 0;
  try {
    const result = await pool.query(
      `DELETE FROM token_scan_cache WHERE expires_at < NOW()`
    );
    const deleted = result.rowCount || 0;
    if (deleted > 0) {
      console.log(`[DB Cache] Cleaned up ${deleted} expired entries`);
    }
    return deleted;
  } catch (error) {
    console.error('[DB Cache] Cleanup error:', error);
    return 0;
  }
}

/**
 * Get cache stats
 */
export async function getCacheStats(): Promise<{ total: number; oldest: Date | null }> {
  if (!pool) return { total: 0, oldest: null };
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as total, MIN(created_at) as oldest FROM token_scan_cache WHERE expires_at > NOW()`
    );
    return {
      total: parseInt(result.rows[0].total) || 0,
      oldest: result.rows[0].oldest,
    };
  } catch (error) {
    console.error('[DB Cache] Stats error:', error);
    return { total: 0, oldest: null };
  }
}

// Initialize table on module load
initCacheTable().catch(console.error);
