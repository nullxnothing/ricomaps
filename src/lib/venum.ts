/**
 * Venum execution-infrastructure client (https://venum.dev).
 *
 * RicoMaps stays read-only/forensic: this wrapper only consumes Venum's
 * market-data surface (batch prices + pool snapshots) to replace the
 * GeckoTerminal / DAS `pricePerToken` pricing path with real, multi-DEX,
 * swap-derived prices that resolve on fresh launches (where Gecko is empty).
 *
 * Everything degrades gracefully: with no `VENUM_API_KEY`, or on any error,
 * functions return `null` so callers fall back to the existing price sources.
 * The live SSE price stream is proxied to the browser by
 * `src/app/api/prices/stream/route.ts` (keeps the key server-side).
 */

const VENUM_BASE = process.env.VENUM_BASE_URL || 'https://api.venum.dev';
const VENUM_API_KEY = process.env.VENUM_API_KEY || '';

export function isVenumEnabled(): boolean {
  return VENUM_API_KEY.length > 0;
}

export function getVenumApiKey(): string {
  return VENUM_API_KEY;
}

export function getVenumBaseUrl(): string {
  return VENUM_BASE;
}

// ─── Types (mirrors docs.venum.dev/api) ──────────────────────────────────────

/** A resolved price from GET /v1/prices or the `price` SSE event. */
export interface VenumPrice {
  token: string;
  priceUsd: number;
  bestBid?: number;
  bestAsk?: number;
  bestBidPool?: string;
  bestAskPool?: string;
  bestBidDex?: string;
  bestAskDex?: string;
  bestBidFeeBps?: number;
  bestAskFeeBps?: number;
  /** Age of the freshest pool data used. -1 = no recent updates. */
  poolCacheAgeMs?: number;
  confidence?: 'confirmed' | 'optimistic';
  poolCount?: number;
  timestamp?: number;
  /** "direct" or a multi-hop path like "TOKEN/X × X/USDC". */
  route?: string;
  change24h?: number;
}

/** A token with no active pool: Venum returns this instead of omitting it. */
export interface VenumPriceUnavailable {
  status: 'unavailable';
  reason?: string;
}

type VenumPriceEntry = VenumPrice | VenumPriceUnavailable;

interface VenumPricesResponse {
  prices: Record<string, VenumPriceEntry>;
  timestamp: number;
}

/** A pool snapshot from GET /v1/pools. */
export interface VenumPool {
  address: string;
  dex: string;
  mintA: string;
  mintB: string;
  symbolA?: string;
  symbolB?: string;
  decimalsA?: number;
  decimalsB?: number;
  feeBps?: number;
  price?: number;
  baseSymbol?: string;
  quoteSymbol?: string;
  reserveA?: string;
  reserveB?: string;
  sqrtPrice?: string;
  tickCurrent?: number;
  cacheAgeMs?: number;
  tvlUsd?: number;
  volume24hUsd?: number;
}

interface VenumPoolsResponse {
  pools: VenumPool[];
  count: number;
  total: number;
  offset: number;
  limit: number;
}

export function isPriceAvailable(entry: VenumPriceEntry | undefined): entry is VenumPrice {
  return !!entry && (entry as VenumPriceUnavailable).status !== 'unavailable';
}

// ─── Tiny in-memory TTL cache (mirrors helius.ts pattern) ────────────────────

interface CacheEntry<T> {
  value: T;
  expires: number;
}
const cache = new Map<string, CacheEntry<unknown>>();
const PRICES_TTL = 2_000; // Venum batch prices carry a ~2s server cache
const POOLS_TTL = 5_000;

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttl: number): void {
  cache.set(key, { value, expires: Date.now() + ttl });
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (VENUM_API_KEY) headers['x-api-key'] = VENUM_API_KEY;
  return headers;
}

// ─── Prices ──────────────────────────────────────────────────────────────────

/**
 * Batch price lookup: GET /v1/prices?tokens=...
 * Accepts up to 50 tracked symbols or mint addresses. Returns a map keyed by
 * the symbol/mint you passed; unavailable tokens carry `{ status: 'unavailable' }`.
 * Returns `null` on error so callers fall back to existing price sources.
 */
export async function getVenumPrices(
  tokens: string[]
): Promise<Record<string, VenumPriceEntry> | null> {
  const unique = Array.from(new Set(tokens.map(t => t.trim()).filter(Boolean))).slice(0, 50);
  if (unique.length === 0) return {};

  const cacheKey = `prices:${unique.slice().sort().join(',')}`;
  const cached = getCached<Record<string, VenumPriceEntry>>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${VENUM_BASE}/v1/prices?tokens=${encodeURIComponent(unique.join(','))}`;
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data: VenumPricesResponse = await res.json();
    const prices = data.prices ?? {};
    setCached(cacheKey, prices, PRICES_TTL);
    return prices;
  } catch {
    return null;
  }
}

/**
 * Single-token USD price convenience helper. Returns `null` when Venum has no
 * active pool for the token (or on error), so callers can fall back cleanly.
 */
export async function getVenumPriceUsd(token: string): Promise<number | null> {
  const prices = await getVenumPrices([token]);
  if (!prices) return null;
  const entry = prices[token] ?? prices[token.trim()];
  return isPriceAvailable(entry) ? entry.priceUsd : null;
}

// ─── Pools ───────────────────────────────────────────────────────────────────

export interface VenumPoolsQuery {
  /** Pools containing this token. */
  token?: string;
  /** Pools containing ANY of these tokens. */
  tokens?: string[];
  /** Pools for a specific pair, e.g. ['SOL', 'USDC']. */
  pair?: [string, string];
  /** Filter by DEX, e.g. 'orca-whirlpool'. */
  dex?: string;
  /** Results per page (max 200). */
  limit?: number;
  offset?: number;
}

/**
 * Pool snapshots: GET /v1/pools. Returns `null` on error.
 */
export async function getVenumPools(query: VenumPoolsQuery = {}): Promise<VenumPool[] | null> {
  const params = new URLSearchParams();
  if (query.token) params.set('token', query.token);
  if (query.tokens?.length) params.set('tokens', query.tokens.join(','));
  if (query.pair) params.set('pair', query.pair.join(','));
  if (query.dex) params.set('dex', query.dex);
  if (query.limit) params.set('limit', String(Math.min(Math.max(1, query.limit), 200)));
  if (query.offset) params.set('offset', String(query.offset));

  const cacheKey = `pools:${params.toString()}`;
  const cached = getCached<VenumPool[]>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${VENUM_BASE}/v1/pools?${params.toString()}`;
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data: VenumPoolsResponse = await res.json();
    const pools = data.pools ?? [];
    setCached(cacheKey, pools, POOLS_TTL);
    return pools;
  } catch {
    return null;
  }
}
