import { pLimit } from './concurrency';

const SHARED_HOLDER_THRESHOLD = 3;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CONCURRENCY_LIMIT = 5;

interface WalletBalance {
  mint: string;
  balance: number;
  decimals: number;
  symbol?: string;
  name?: string;
  usdValue?: number;
}

interface BalancesResponse {
  balances: WalletBalance[];
  pagination?: { hasMore: boolean };
}

interface TokenAssetMetadata {
  name: string;
  symbol: string;
  image?: string;
  pricePerToken?: number;
}

export interface SharedTokenHolder {
  address: string;
  balance: number;
  usdValue: number;
}

export interface SharedToken {
  mint: string;
  name: string;
  symbol: string;
  image?: string;
  holders: SharedTokenHolder[];
  holderCount: number;
}

export interface CrossTokenResult {
  sharedTokens: SharedToken[];
  totalWalletsAnalyzed: number;
  analysisTimestamp: number;
}

// Simple in-memory cache
const resultCache = new Map<string, { result: CrossTokenResult; expiresAt: number }>();

function getCacheKey(wallets: string[]): string {
  return [...wallets].sort().join(',');
}

async function fetchWalletBalances(wallet: string, apiKey: string): Promise<{ wallet: string; tokens: WalletBalance[] }> {
  const tokens: WalletBalance[] = [];

  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({
      'api-key': apiKey,
      page: String(page),
      limit: '100',
      showNative: 'false',
      showNfts: 'false',
    });
    const res = await fetch(`https://api.helius.xyz/v1/wallet/${wallet}/balances?${params}`);
    if (!res.ok) {
      console.error(`Failed to fetch balances for ${wallet}: ${res.status}`);
      break;
    }

    const data: BalancesResponse = await res.json();
    tokens.push(...(data.balances ?? []));
    if (!data.pagination?.hasMore) break;
  }

  return { wallet, tokens };
}

async function fetchTokenMetadata(mint: string, apiKey: string): Promise<TokenAssetMetadata> {
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: mint,
      method: 'getAsset',
      params: { id: mint },
    }),
  });

  if (!res.ok) {
    return { name: 'Unknown', symbol: '???', image: undefined };
  }

  const json = await res.json();
  const asset = json.result;
  if (!asset) {
    return { name: 'Unknown', symbol: '???', image: undefined };
  }

  return {
    name: asset.content?.metadata?.name || 'Unknown',
    symbol: asset.content?.metadata?.symbol || '???',
    image: asset.content?.links?.image || asset.content?.files?.[0]?.uri,
    pricePerToken: asset.token_info?.price_info?.price_per_token,
  };
}

export async function analyzeCrossTokenHoldings(
  cabalWallets: string[],
  apiKey: string
): Promise<CrossTokenResult> {
  const cacheKey = getCacheKey(cabalWallets);
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const limit = pLimit(CONCURRENCY_LIMIT);

  // Fetch all wallet balances concurrently (capped at 5)
  const balanceResults = await Promise.all(
    cabalWallets.map(wallet => limit(() => fetchWalletBalances(wallet, apiKey)))
  );

  // Build a map: mint -> list of { wallet, balance, decimals }
  const mintHolders = new Map<string, { address: string; balance: number; usdValue: number }[]>();

  for (const { wallet, tokens } of balanceResults) {
    for (const token of tokens) {
      if (!token.mint || token.balance <= 0) continue;
      if (!mintHolders.has(token.mint)) {
        mintHolders.set(token.mint, []);
      }
      mintHolders.get(token.mint)!.push({
        address: wallet,
        balance: token.balance,
        usdValue: token.usdValue ?? 0,
      });
    }
  }

  // Filter to mints held by SHARED_HOLDER_THRESHOLD+ cabal wallets
  const sharedMints: { mint: string; holders: { address: string; balance: number; usdValue: number }[] }[] = [];
  for (const [mint, holders] of mintHolders) {
    if (holders.length >= SHARED_HOLDER_THRESHOLD) {
      sharedMints.push({ mint, holders });
    }
  }

  // Sort by holder count descending before metadata fetch
  sharedMints.sort((a, b) => b.holders.length - a.holders.length);

  // Fetch metadata for shared tokens (capped concurrency)
  const metadataLimit = pLimit(CONCURRENCY_LIMIT);
  const metadataResults = await Promise.all(
    sharedMints.map(({ mint }) => metadataLimit(() => fetchTokenMetadata(mint, apiKey)))
  );

  // Build final result
  const sharedTokens: SharedToken[] = sharedMints.map(({ mint, holders }, idx) => {
    const meta = metadataResults[idx];
    const pricePerToken = meta.pricePerToken || 0;

    return {
      mint,
      name: meta.name,
      symbol: meta.symbol,
      image: meta.image,
      holders: holders.map(h => {
        return {
          address: h.address,
          balance: h.balance,
          usdValue: h.usdValue || h.balance * pricePerToken,
        };
      }),
      holderCount: holders.length,
    };
  });

  const result: CrossTokenResult = {
    sharedTokens,
    totalWalletsAnalyzed: cabalWallets.length,
    analysisTimestamp: Date.now(),
  };

  // Cache the result
  resultCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}
