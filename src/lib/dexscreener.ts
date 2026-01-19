import { DexScreenerBoostToken, DexScreenerPair, EnrichedToken } from './types';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const DEXSCREENER_CDN = 'https://dd.dexscreener.com/ds-data/tokens';

function formatIconUrl(icon: string | undefined, chainId: string, tokenAddress: string): string {
  // If no icon provided or it's just a hash, use the CDN URL with token address
  if (!icon || !icon.startsWith('http')) {
    return `${DEXSCREENER_CDN}/${chainId}/${tokenAddress}.png`;
  }
  return icon;
}

export async function getTopBoostedTokens(): Promise<DexScreenerBoostToken[]> {
  const response = await fetch(`${DEXSCREENER_API}/token-boosts/top/v1`, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`DexScreener API error: ${response.status}`);
  }

  const data: DexScreenerBoostToken[] = await response.json();

  // Filter for Solana tokens only
  return data.filter(token => token.chainId === 'solana');
}

export async function getTokenPairs(address: string): Promise<DexScreenerPair[]> {
  const response = await fetch(
    `${DEXSCREENER_API}/token-pairs/v1/solana/${address}`,
    { headers: { 'Accept': 'application/json' } }
  );

  if (!response.ok) {
    throw new Error(`DexScreener API error: ${response.status}`);
  }

  const data: DexScreenerPair[] = await response.json();
  return data;
}

export async function enrichTokenData(
  boostTokens: DexScreenerBoostToken[]
): Promise<EnrichedToken[]> {
  const enrichedTokens: EnrichedToken[] = [];

  // Process tokens in batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < boostTokens.length; i += batchSize) {
    const batch = boostTokens.slice(i, i + batchSize);

    const enrichedBatch = await Promise.all(
      batch.map(async (token) => {
        try {
          const pairs = await getTokenPairs(token.tokenAddress);

          // Get the pair with highest liquidity
          const bestPair = pairs
            .filter(p => p.liquidity?.usd && p.liquidity.usd > 0)
            .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

          if (!bestPair) return null;

          // Validate required data
          const priceUsd = parseFloat(bestPair.priceUsd);
          const volume24h = bestPair.volume?.h24 || 0;
          const marketCap = bestPair.marketCap || bestPair.fdv || 0;
          const liquidity = bestPair.liquidity?.usd || 0;
          const icon = formatIconUrl(token.icon, token.chainId, token.tokenAddress);

          // Filter: must have price, volume > 0, marketCap > 0
          if (!priceUsd || volume24h <= 0 || marketCap <= 0) {
            return null;
          }

          return {
            address: token.tokenAddress,
            name: bestPair.baseToken.name,
            symbol: bestPair.baseToken.symbol,
            icon,
            priceUsd,
            priceChange24h: bestPair.priceChange?.h24 || 0,
            volume24h,
            marketCap,
            liquidity,
            boostAmount: token.totalAmount,
          } as EnrichedToken;
        } catch (err) {
          console.error(`Failed to enrich token ${token.tokenAddress}:`, err);
          return null;
        }
      })
    );

    enrichedTokens.push(
      ...enrichedBatch.filter((t): t is EnrichedToken => t !== null)
    );

    // Small delay between batches to respect rate limits
    if (i + batchSize < boostTokens.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return enrichedTokens;
}

export async function getTrendingAndFeaturedTokens(): Promise<{
  trending: EnrichedToken[];
  featured: EnrichedToken[];
}> {
  const boostTokens = await getTopBoostedTokens();
  const enrichedTokens = await enrichTokenData(boostTokens.slice(0, 30)); // Get top 30 to ensure 20 valid

  // Split into trending (top 10) and featured (next 10)
  const validTokens = enrichedTokens.slice(0, 20);

  return {
    trending: validTokens.slice(0, 10),
    featured: validTokens.slice(10, 20),
  };
}
