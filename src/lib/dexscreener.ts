import { EnrichedToken, TokenMetadata } from './types';

const GECKO_API = 'https://api.geckoterminal.com/api/v2';

interface GeckoPool {
  id: string;
  attributes: {
    name: string;
    address: string;
    base_token_price_usd: string;
    quote_token_price_usd: string;
    fdv_usd: string;
    market_cap_usd: string | null;
    reserve_in_usd: string;
    pool_created_at: string;
    price_change_percentage: {
      h1: string;
      h6: string;
      h24: string;
    };
    volume_usd: {
      h1: string;
      h6: string;
      h24: string;
    };
    transactions: {
      h1: { buys: number; sells: number };
      h24: { buys: number; sells: number };
    };
  };
  relationships: {
    base_token: { data: { id: string } };
    dex: { data: { id: string } };
  };
}

interface GeckoToken {
  id: string;
  attributes: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    image_url: string | null;
  };
}

interface GeckoResponse {
  data: GeckoPool[];
  included?: GeckoToken[];
}

export async function getTrendingAndFeaturedTokens(): Promise<{
  trending: EnrichedToken[];
  featured: EnrichedToken[];
}> {
  // Fetch trending pools + new pools in parallel
  const [trendingRes, newRes] = await Promise.all([
    fetch(`${GECKO_API}/networks/solana/trending_pools?page=1&include=base_token`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
    }),
    fetch(`${GECKO_API}/networks/solana/new_pools?page=1&include=base_token`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
    }),
  ]);

  if (!trendingRes.ok) throw new Error(`GeckoTerminal trending error: ${trendingRes.status}`);
  if (!newRes.ok) throw new Error(`GeckoTerminal new pools error: ${newRes.status}`);

  const trendingData: GeckoResponse = await trendingRes.json();
  const newData: GeckoResponse = await newRes.json();

  const trendingTokens = parseGeckoResponse(trendingData).slice(0, 10);
  const featuredTokens = parseGeckoResponse(newData).slice(0, 10);

  // Dedupe: remove featured tokens that are already in trending
  const trendingAddresses = new Set(trendingTokens.map(t => t.address));
  const dedupedFeatured = featuredTokens.filter(t => !trendingAddresses.has(t.address));

  return {
    trending: trendingTokens,
    featured: dedupedFeatured.length >= 10 ? dedupedFeatured.slice(0, 10) : dedupedFeatured,
  };
}

function parseGeckoResponse(data: GeckoResponse): EnrichedToken[] {
  const tokenMap = new Map<string, GeckoToken>();

  for (const token of data.included ?? []) {
    tokenMap.set(token.id, token);
  }

  const results: EnrichedToken[] = [];
  const seenAddresses = new Set<string>();

  for (const pool of data.data) {
    const attrs = pool.attributes;
    const baseTokenId = pool.relationships.base_token.data.id;
    const tokenInfo = tokenMap.get(baseTokenId);

    if (!tokenInfo) continue;

    const address = tokenInfo.attributes.address;
    if (seenAddresses.has(address)) continue;
    seenAddresses.add(address);

    const priceUsd = parseFloat(attrs.base_token_price_usd) || 0;
    const volume24h = parseFloat(attrs.volume_usd.h24) || 0;
    const marketCap = parseFloat(attrs.market_cap_usd ?? attrs.fdv_usd) || 0;
    const liquidity = parseFloat(attrs.reserve_in_usd) || 0;
    const priceChange24h = parseFloat(attrs.price_change_percentage.h24) || 0;

    if (priceUsd <= 0 || volume24h <= 0) continue;

    const icon = tokenInfo.attributes.image_url
      || `https://dd.dexscreener.com/ds-data/tokens/solana/${address}.png`;

    results.push({
      address,
      name: tokenInfo.attributes.name,
      symbol: tokenInfo.attributes.symbol,
      icon,
      priceUsd,
      priceChange24h,
      volume24h,
      marketCap,
      liquidity,
    });
  }

  return results;
}

// ─── DexScreener token pairs API ───────────────────────────────────────────
interface DexPairInfo {
  imageUrl?: string;
  websites?: { label: string; url: string }[];
  socials?: { type: string; url: string }[];
}

interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { m5?: number; h1?: number; h24?: number };
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
  };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  info?: DexPairInfo;
}

interface DexTokenResponse {
  pairs?: DexPair[];
}

/**
 * Batch market snapshot for up to 30 mints (DexScreener tokens/v1 endpoint).
 * Returns only mints that have at least one Solana pair; callers treat absence
 * as zero liquidity. Used by the atlas outcome tracker.
 */
export async function fetchMarketDataBatch(
  mints: string[]
): Promise<Map<string, { liquidityUsd: number; marketCapUsd?: number }>> {
  const out = new Map<string, { liquidityUsd: number; marketCapUsd?: number }>();
  if (mints.length === 0) return out;

  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.slice(0, 30).join(',')}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return out;

    const pairs: DexPair[] = await res.json();
    for (const pair of pairs) {
      if (pair.chainId !== 'solana') continue;
      const mint = (pair as DexPair & { baseToken?: { address?: string } }).baseToken?.address;
      if (!mint) continue;
      const liquidityUsd = pair.liquidity?.usd ?? 0;
      const existing = out.get(mint);
      if (!existing || liquidityUsd > existing.liquidityUsd) {
        out.set(mint, { liquidityUsd, marketCapUsd: pair.marketCap ?? pair.fdv });
      }
    }
  } catch {
    // Network failure → empty map; outcome pass skips this round rather than mislabeling.
  }
  return out;
}

/**
 * Fetch market data + social links for a Solana token from DexScreener.
 * Returns a partial TokenMetadata, merged into the main metadata after DAS fetch.
 */
export async function fetchTokenMarketData(mint: string): Promise<Partial<TokenMetadata> | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data: DexTokenResponse = await res.json();
    const pairs = data.pairs?.filter(p => p.chainId === 'solana') ?? [];
    if (pairs.length === 0) return null;

    // Pick highest-liquidity pair as the canonical one
    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const info = best.info;

    const result: Partial<TokenMetadata> = {
      priceUsd: best.priceUsd ? parseFloat(best.priceUsd) : undefined,
      priceChange24h: best.priceChange?.h24,
      volume24h: best.volume?.h24,
      volume1h: best.volume?.h1,
      volume5m: best.volume?.m5,
      txns5m: best.txns?.m5,
      txns1h: best.txns?.h1,
      liquidity: best.liquidity?.usd,
      fdv: best.fdv,
      marketCap: best.marketCap,
      dexUrl: best.url,
      pairAddress: best.pairAddress,
    };

    if (info) {
      const website = info.websites?.[0]?.url;
      if (website) result.website = website;

      for (const social of info.socials ?? []) {
        const t = social.type?.toLowerCase();
        if (t === 'twitter' || t === 'x') result.twitter = social.url;
        else if (t === 'telegram') result.telegram = social.url;
        else if (t === 'discord') result.discord = social.url;
      }
    }

    return result;
  } catch {
    return null;
  }
}
