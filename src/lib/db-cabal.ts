import { getPool } from './db-pool';
import { getCabalFingerprints } from './cabal-fingerprint';
import { getTrendingAndFeaturedTokens } from './dexscreener';
import { AtlasCabalNode, AtlasGraph, AtlasStats, AtlasToken, AtlasTokenStatus, CabalFingerprint } from './types';

const pool = getPool();

export type { AtlasToken, AtlasTokenStatus, AtlasStats, AtlasCabalNode, AtlasGraph };

// Rugged/dead are terminal — outcome passes never resurrect a corpse.
const TERMINAL_STATUSES: AtlasTokenStatus[] = ['rugged', 'dead'];

// ============================================================================
// IN-MEMORY FALLBACK
// ============================================================================
const memTokens = new Map<string, AtlasToken>();

function memMerge(existing: AtlasToken | undefined, patch: Partial<AtlasToken> & { mint: string }): AtlasToken {
  const base: AtlasToken = existing ?? { mint: patch.mint, status: 'watching', createdAt: Math.floor(Date.now() / 1000) };
  const merged = { ...base, ...stripUndefined(patch) };
  if (existing && TERMINAL_STATUSES.includes(existing.status)) merged.status = existing.status;
  merged.peakLiquidityUsd = Math.max(merged.peakLiquidityUsd ?? 0, merged.liquidityUsd ?? 0) || undefined;
  return merged;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ============================================================================
// POSTGRES
// ============================================================================
async function initAtlasTables(): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS atlas_tokens (
        mint VARCHAR(64) PRIMARY KEY,
        name VARCHAR(256),
        symbol VARCHAR(64),
        image TEXT,
        status VARCHAR(16) NOT NULL DEFAULT 'watching',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        graduated_at TIMESTAMP,
        scanned_at TIMESTAMP,
        last_checked_at TIMESTAMP,
        liquidity_usd DOUBLE PRECISION,
        peak_liquidity_usd DOUBLE PRECISION,
        market_cap_usd DOUBLE PRECISION,
        rug_level VARCHAR(8),
        cabal_supply_pct DOUBLE PRECISION,
        est_extracted_usd DOUBLE PRECISION
      );
      CREATE INDEX IF NOT EXISTS idx_atlas_tokens_status ON atlas_tokens(status, last_checked_at);
      CREATE INDEX IF NOT EXISTS idx_atlas_tokens_created ON atlas_tokens(created_at DESC);
    `);
    // Backfill column on pre-existing deployments (table created before image existed).
    await pool.query(`ALTER TABLE atlas_tokens ADD COLUMN IF NOT EXISTS image TEXT;`);
  } catch (error) {
    console.error('[Atlas] Failed to initialize tables:', error);
  }
}

function rowToToken(r: Record<string, unknown>): AtlasToken {
  return {
    mint: r.mint as string,
    name: (r.name as string) ?? undefined,
    symbol: (r.symbol as string) ?? undefined,
    image: (r.image as string) ?? undefined,
    status: r.status as AtlasTokenStatus,
    createdAt: Number(r.created_ts),
    graduatedAt: r.graduated_ts != null ? Number(r.graduated_ts) : undefined,
    scannedAt: r.scanned_ts != null ? Number(r.scanned_ts) : undefined,
    lastCheckedAt: r.checked_ts != null ? Number(r.checked_ts) : undefined,
    liquidityUsd: r.liquidity_usd != null ? Number(r.liquidity_usd) : undefined,
    peakLiquidityUsd: r.peak_liquidity_usd != null ? Number(r.peak_liquidity_usd) : undefined,
    marketCapUsd: r.market_cap_usd != null ? Number(r.market_cap_usd) : undefined,
    rugLevel: (r.rug_level as AtlasToken['rugLevel']) ?? undefined,
    cabalSupplyPct: r.cabal_supply_pct != null ? Number(r.cabal_supply_pct) : undefined,
    estExtractedUsd: r.est_extracted_usd != null ? Number(r.est_extracted_usd) : undefined,
  };
}

const TOKEN_SELECT = `
  SELECT mint, name, symbol, image, status,
         EXTRACT(EPOCH FROM created_at)::bigint AS created_ts,
         EXTRACT(EPOCH FROM graduated_at)::bigint AS graduated_ts,
         EXTRACT(EPOCH FROM scanned_at)::bigint AS scanned_ts,
         EXTRACT(EPOCH FROM last_checked_at)::bigint AS checked_ts,
         liquidity_usd, peak_liquidity_usd, market_cap_usd, rug_level, cabal_supply_pct, est_extracted_usd
  FROM atlas_tokens`;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Merge-upsert a token into the atlas registry. Only provided fields overwrite;
 * peak liquidity ratchets upward; terminal statuses (rugged/dead) never revert.
 */
export async function upsertAtlasToken(patch: Partial<AtlasToken> & { mint: string }): Promise<void> {
  memTokens.set(patch.mint, memMerge(memTokens.get(patch.mint), patch));
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO atlas_tokens (mint, name, symbol, image, status, created_at, graduated_at, scanned_at, last_checked_at,
                                 liquidity_usd, peak_liquidity_usd, market_cap_usd, rug_level, cabal_supply_pct, est_extracted_usd)
       VALUES ($1, $2, $3, $15::text, COALESCE($4::text, 'watching'), COALESCE(to_timestamp($5), CURRENT_TIMESTAMP), to_timestamp($6), to_timestamp($7), to_timestamp($8),
               $9::double precision, GREATEST(COALESCE($10::double precision, 0), COALESCE($9::double precision, 0)), $11::double precision, $12::text, $13::double precision, $14::double precision)
       ON CONFLICT (mint) DO UPDATE SET
         name = COALESCE($2::text, atlas_tokens.name),
         symbol = COALESCE($3::text, atlas_tokens.symbol),
         image = COALESCE($15::text, atlas_tokens.image),
         status = CASE WHEN atlas_tokens.status IN ('rugged', 'dead') THEN atlas_tokens.status
                       ELSE COALESCE($4::text, atlas_tokens.status) END,
         graduated_at = COALESCE(to_timestamp($6), atlas_tokens.graduated_at),
         scanned_at = COALESCE(to_timestamp($7), atlas_tokens.scanned_at),
         last_checked_at = COALESCE(to_timestamp($8), atlas_tokens.last_checked_at),
         liquidity_usd = COALESCE($9::double precision, atlas_tokens.liquidity_usd),
         peak_liquidity_usd = GREATEST(COALESCE(atlas_tokens.peak_liquidity_usd, 0), COALESCE($10::double precision, 0), COALESCE($9::double precision, 0)),
         market_cap_usd = COALESCE($11::double precision, atlas_tokens.market_cap_usd),
         rug_level = COALESCE($12::text, atlas_tokens.rug_level),
         cabal_supply_pct = COALESCE($13::double precision, atlas_tokens.cabal_supply_pct),
         est_extracted_usd = COALESCE($14::double precision, atlas_tokens.est_extracted_usd)`,
      [
        patch.mint, patch.name ?? null, patch.symbol ?? null, patch.status ?? null,
        patch.createdAt ?? null, patch.graduatedAt ?? null, patch.scannedAt ?? null, patch.lastCheckedAt ?? null,
        patch.liquidityUsd ?? null, patch.peakLiquidityUsd ?? null, patch.marketCapUsd ?? null,
        patch.rugLevel ?? null, patch.cabalSupplyPct ?? null, patch.estExtractedUsd ?? null, patch.image ?? null,
      ]
    );
  } catch (error) {
    console.error('[Atlas] upsert error:', error);
  }
}

/** Tokens due for an outcome re-check, stalest first. Watching-only tokens are skipped (no market data yet). */
export async function listOutcomeCandidates(limit = 30): Promise<AtlasToken[]> {
  if (!pool) {
    return [...memTokens.values()]
      .filter(t => t.status === 'scanned' || t.status === 'alive')
      .sort((a, b) => (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0))
      .slice(0, limit);
  }
  try {
    const res = await pool.query(
      `${TOKEN_SELECT} WHERE status IN ('scanned', 'alive') ORDER BY last_checked_at ASC NULLS FIRST LIMIT $1`,
      [limit]
    );
    return res.rows.map(rowToToken);
  } catch (error) {
    console.error('[Atlas] outcome candidates error:', error);
    return [];
  }
}

export async function getAtlasTokens(mints: string[]): Promise<Map<string, AtlasToken>> {
  const out = new Map<string, AtlasToken>();
  if (mints.length === 0) return out;
  if (!pool) {
    for (const m of mints) {
      const t = memTokens.get(m);
      if (t) out.set(m, t);
    }
    return out;
  }
  try {
    const placeholders = mints.map((_, i) => `$${i + 1}`).join(',');
    const res = await pool.query(`${TOKEN_SELECT} WHERE mint IN (${placeholders})`, mints);
    for (const row of res.rows) {
      const t = rowToToken(row);
      out.set(t.mint, t);
    }
  } catch (error) {
    console.error('[Atlas] get tokens error:', error);
  }
  return out;
}

/** Most recently created tokens still on the board (any status) — the "fresh launches" ring. */
export async function listRecentAtlasTokens(limit = 100, sinceSec?: number): Promise<AtlasToken[]> {
  const cutoff = sinceSec ?? Math.floor(Date.now() / 1000) - 24 * 3600;
  if (!pool) {
    return [...memTokens.values()]
      .filter(t => t.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  try {
    const res = await pool.query(
      `${TOKEN_SELECT} WHERE created_at >= to_timestamp($1) ORDER BY created_at DESC LIMIT $2`,
      [cutoff, limit]
    );
    return res.rows.map(rowToToken);
  } catch (error) {
    console.error('[Atlas] recent tokens error:', error);
    return [];
  }
}

export async function getAtlasStats(): Promise<AtlasStats> {
  const daySec = Math.floor(Date.now() / 1000) - 24 * 3600;
  const { fingerprints, total } = await getCabalFingerprints({ limit: 500 });
  const cabalsActive24h = fingerprints.filter(f => f.lastSeen >= daySec).length;

  if (!pool) {
    const tokens = [...memTokens.values()];
    return {
      cabalsTracked: total,
      cabalsActive24h,
      tokensTracked: tokens.length,
      rugs24h: tokens.filter(t => t.status === 'rugged' && (t.lastCheckedAt ?? 0) >= daySec).length,
      totalExtractedUsd: tokens.reduce((sum, t) => sum + (t.estExtractedUsd ?? 0), 0),
    };
  }
  try {
    const res = await pool.query(
      `SELECT COUNT(*)::int AS tokens_tracked,
              COUNT(*) FILTER (WHERE status = 'rugged' AND last_checked_at >= to_timestamp($1))::int AS rugs_24h,
              COALESCE(SUM(est_extracted_usd), 0) AS total_extracted
       FROM atlas_tokens`,
      [daySec]
    );
    const row = res.rows[0];
    return {
      cabalsTracked: total,
      cabalsActive24h,
      tokensTracked: row.tokens_tracked,
      rugs24h: row.rugs_24h,
      totalExtractedUsd: Number(row.total_extracted),
    };
  } catch (error) {
    console.error('[Atlas] stats error:', error);
    return { cabalsTracked: total, cabalsActive24h, tokensTracked: 0, rugs24h: 0, totalExtractedUsd: 0 };
  }
}

/**
 * The battlefield: top cabals by confidence, every token they touched, plus the
 * fresh-launch ring. Edges connect crews to their tokens. Built in TS over the
 * existing fingerprint store so PG and in-memory behave identically.
 */
export async function getAtlasGraph(options: { maxCabals?: number; maxRecentTokens?: number } = {}): Promise<AtlasGraph> {
  const { maxCabals = 60, maxRecentTokens = 120 } = options;

  const [{ fingerprints }, recentTokens, stats] = await Promise.all([
    getCabalFingerprints({ limit: maxCabals }),
    listRecentAtlasTokens(maxRecentTokens),
    getAtlasStats(),
  ]);

  const linkedMints = [...new Set(fingerprints.flatMap(f => f.tokens.map(t => t.mint)))];
  const atlasRows = await getAtlasTokens(linkedMints);

  const edges: AtlasGraph['edges'] = [];
  const cabals: AtlasCabalNode[] = fingerprints.map(fp => {
    let ruggedCount = 0;
    let extracted = 0;
    for (const t of fp.tokens) {
      edges.push({ cabalId: fp.id, mint: t.mint, supplyPct: t.cabalSupplyPct });
      const atlas = atlasRows.get(t.mint);
      if (atlas?.status === 'rugged' || t.rugLevel === 'red') ruggedCount++;
      extracted += atlas?.estExtractedUsd ?? 0;
    }
    return {
      id: fp.id,
      confidence: fp.confidence,
      tokenCount: fp.tokens.length,
      walletCount: fp.knownWallets.length,
      funderCategory: fp.components.funderCategory ?? 'unknown',
      lastSeen: fp.lastSeen,
      ruggedCount,
      estExtractedUsd: extracted,
    };
  });

  // Token nodes: union of cabal-linked tokens and the fresh-launch ring. Linked
  // tokens missing an atlas row (scanned before this table existed) still render,
  // synthesized from fingerprint history.
  const tokenMap = new Map<string, AtlasToken>();
  for (const t of recentTokens) tokenMap.set(t.mint, t);
  for (const fp of fingerprints) {
    for (const t of fp.tokens) {
      if (tokenMap.has(t.mint)) continue;
      tokenMap.set(t.mint, atlasRows.get(t.mint) ?? {
        mint: t.mint,
        name: t.tokenName,
        symbol: t.tokenSymbol,
        status: 'scanned',
        createdAt: t.firstSeen,
        rugLevel: t.rugLevel,
        cabalSupplyPct: t.cabalSupplyPct,
      });
    }
  }

  // Seed the board with live trending tokens (DexScreener/GeckoTerminal) so the
  // map is always populated with real, logo'd tokens — not just what's been
  // scanned. Existing entries keep their richer atlas/cabal data.
  const trending = await getTrendingTokensForAtlas();
  for (const t of trending) if (!tokenMap.has(t.mint)) tokenMap.set(t.mint, t);

  return { cabals, tokens: [...tokenMap.values()], edges, stats };
}

// Trending tokens cached briefly — the atlas refreshes every ~15s, GeckoTerminal
// is rate-limited, and trending barely moves minute to minute.
let trendingCache: { tokens: AtlasToken[]; at: number } | null = null;
const TRENDING_TTL_MS = 60_000;

async function getTrendingTokensForAtlas(): Promise<AtlasToken[]> {
  if (trendingCache && Date.now() - trendingCache.at < TRENDING_TTL_MS) return trendingCache.tokens;
  try {
    const { trending, featured } = await getTrendingAndFeaturedTokens();
    const now = Math.floor(Date.now() / 1000);
    const tokens: AtlasToken[] = [...trending, ...featured].map((t) => ({
      mint: t.address,
      name: t.name,
      symbol: t.symbol,
      image: t.icon,
      status: 'alive',
      createdAt: now,
      liquidityUsd: t.liquidity,
      marketCapUsd: t.marketCap,
    }));
    trendingCache = { tokens, at: Date.now() };
    return tokens;
  } catch (error) {
    console.error('[Atlas] trending seed error:', error);
    return trendingCache?.tokens ?? [];
  }
}

export type { CabalFingerprint };

initAtlasTables().catch(console.error);
