import {
  HeliusTransaction,
  TokenHolder,
  HeliusAsset,
  HeliusTransactionType,
  TokenSecurityInfo,
  EnrichedFunderInfo,
  WalletProfile
} from './types';

// Dedicated node — fast RPC (~50ms), no key needed, use for all RPC calls
const DEDICATED_RPC_URL = process.env.HELIUS_DEDICATED_RPC || '';

// API keys for Wallet API / Enhanced Transactions API (still need keys)
const API_KEYS = [
  process.env.HELIUS_API_KEY,
  process.env.HELIUS_API_KEY_2,
  process.env.HELIUS_API_KEY_3,
  process.env.HELIUS_API_KEY_4,
].filter(Boolean) as string[];

let currentKeyIndex = 0;

function getNextApiKey(): string {
  if (API_KEYS.length === 0) {
    throw new Error('No Helius API keys configured');
  }
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
}

// RPC URL: use dedicated node if available (faster, no rate limits), fallback to keyed
function getHeliusRpcUrl(apiKey?: string): string {
  if (DEDICATED_RPC_URL) return DEDICATED_RPC_URL;
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey || getNextApiKey()}`;
}

function getHeliusApiUrl(endpoint: string, apiKey?: string): string {
  return `https://api.helius.xyz/v0${endpoint}?api-key=${apiKey || getNextApiKey()}`;
}

// Throttled URL resolvers
// RPC: dedicated node (no throttle needed) or keyed fallback
async function getThrottledRpcUrl(): Promise<string> {
  if (DEDICATED_RPC_URL) return DEDICATED_RPC_URL; // No throttle — dedicated node has no rate limit
  const key = await throttledGetKey();
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

// API: always needs a key (Wallet API, Enhanced Transactions)
async function getThrottledApiUrl(endpoint: string): Promise<string> {
  const key = await throttledGetKey();
  return `https://api.helius.xyz/v0${endpoint}?api-key=${key}`;
}

// Known DEX and mixer sources for forensic detection
const DEX_SOURCES = new Set([
  'JUPITER', 'RAYDIUM', 'ORCA', 'SERUM', 'OPENBOOK', 'PHOENIX',
  'LIFINITY', 'METEORA', 'PUMP_FUN', 'MOONSHOT'
]);

const MIXER_SOURCES = new Set([
  'TORNADO', 'ELUSIV', // Add known mixers
]);

// ============================================================================
// CACHING LAYER - Simple in-memory cache with TTL
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const MAX_CACHE_SIZE = 2000;
const cache = new Map<string, CacheEntry<unknown>>();

// Separate TTLs by data type
const CACHE_TTLS = {
  security: 1 * 60 * 60 * 1000,       // 1 hour
  holders: 15 * 1000,                  // 15 seconds — short for live polling
  transactions: 4 * 60 * 60 * 1000,   // 4 hours
  profiles: 1 * 60 * 60 * 1000,       // 1 hour
  default: 2 * 60 * 60 * 1000,        // 2 hours
};

function getTtlForKey(key: string): number {
  if (key.startsWith('security:')) return CACHE_TTLS.security;
  if (key.startsWith('holders:')) return CACHE_TTLS.holders;
  if (key.startsWith('txs:')) return CACHE_TTLS.transactions;
  if (key.startsWith('profile:')) return CACHE_TTLS.profiles;
  return CACHE_TTLS.default;
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  // Evict oldest entry if at capacity
  if (cache.size >= MAX_CACHE_SIZE && !cache.has(key)) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { data, timestamp: Date.now(), ttl: getTtlForKey(key) });
}

// ============================================================================
// RETRY LOGIC WITH PER-KEY RATE LIMITING + CIRCUIT BREAKER
// ============================================================================

// Per-key rate tracking — allows true parallelism across keys
// Business+ tier: 50 req/15s per key = ~300ms minimum between requests on SAME key
const PER_KEY_INTERVAL = 0; // Business+ = 50 req/s per key, no artificial throttle needed
const keyLastRequestTime = new Map<string, number>();

// Circuit breaker
let consecutiveFailures = 0;
let circuitBreakerTripped = false;
let circuitBreakerResetTime = 0;
const MAX_CONSECUTIVE_FAILURES = 5;
const CIRCUIT_BREAKER_RESET_MS = 30000;

function checkCircuitBreaker(): boolean {
  if (!circuitBreakerTripped) return true;

  if (Date.now() > circuitBreakerResetTime) {
    circuitBreakerTripped = false;
    consecutiveFailures = 0;
    console.log('[Helius] Circuit breaker reset - resuming requests');
    return true;
  }

  return false;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    circuitBreakerTripped = true;
    circuitBreakerResetTime = Date.now() + CIRCUIT_BREAKER_RESET_MS;
    console.warn(`[Helius] Circuit breaker tripped after ${consecutiveFailures} failures.`);
  }
}

// Get the least-recently-used key and throttle only that key
function acquireKey(): { key: string; waitMs: number } {
  const now = Date.now();
  let bestKey = API_KEYS[0];
  let bestWait = Infinity;

  for (const key of API_KEYS) {
    const lastUsed = keyLastRequestTime.get(key) || 0;
    const elapsed = now - lastUsed;
    const wait = Math.max(0, PER_KEY_INTERVAL - elapsed);

    if (wait < bestWait) {
      bestWait = wait;
      bestKey = key;
      if (wait === 0) break; // Found a ready key, use it immediately
    }
  }

  keyLastRequestTime.set(bestKey, now + bestWait);
  return { key: bestKey, waitMs: bestWait };
}

async function throttledGetKey(): Promise<string> {
  const { key, waitMs } = acquireKey();
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  return key;
}

interface FetchOptions extends RequestInit {
  maxRetries?: number;
  baseDelay?: number;
}

async function fetchWithRetry(url: string | (() => Promise<string>), options: FetchOptions = {}): Promise<Response> {
  const { maxRetries = 3, baseDelay = 3000, ...fetchOptions } = options;
  let lastError: Error | null = null;

  if (!checkCircuitBreaker()) {
    throw new Error('Circuit breaker active - API temporarily disabled');
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Resolve URL (may involve per-key throttling)
      const resolvedUrl = typeof url === 'function' ? await url() : url;

      const response = await fetch(resolvedUrl, fetchOptions);

      // Handle rate limiting with backoff
      if (response.status === 429) {
        recordFailure();
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : baseDelay * Math.pow(2, attempt);
        console.warn(`Rate limited (attempt ${attempt + 1}/${maxRetries}). Waiting ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      // Handle server errors with retry
      if (response.status >= 500) {
        recordFailure();
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Server error ${response.status} (attempt ${attempt + 1}/${maxRetries}). Waiting ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      // Handle other errors
      if (!response.ok) {
        recordFailure();
        const errorBody = await response.text();
        throw new Error(`Helius API error ${response.status}: ${errorBody}`);
      }

      // Success! Reset circuit breaker counter
      recordSuccess();
      return response;
    } catch (error) {
      lastError = error as Error;
      recordFailure();
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Request failed (attempt ${attempt + 1}/${maxRetries}). Waiting ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Request failed after max retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// TRANSACTION FETCHING WITH ATA SUPPORT (Hybrid Approach)
// ============================================================================
// Uses new RPC method for signatures (with tokenAccounts filter) + Parse API for enriched data

interface GetTransactionsOptions {
  limit?: number;
  sortOrder?: 'asc' | 'desc';
  tokenAccounts?: 'none' | 'balanceChanged' | 'all';
  skipCache?: boolean; // For real-time streaming, bypass cache
}

interface SignatureData {
  signature: string;
  slot: number;
  blockTime: number;
  err: unknown | null;
}

/**
 * Parse transaction signatures into enriched format using Helius Parse API
 */
async function parseTransactions(signatures: string[]): Promise<HeliusTransaction[]> {
  if (signatures.length === 0) return [];

  const response = await fetchWithRetry(() => getThrottledApiUrl('/transactions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: signatures })
  });

  const transactions: HeliusTransaction[] = await response.json();
  return transactions;
}

export async function getTransactionsForAddress(
  address: string,
  options: GetTransactionsOptions = {}
): Promise<HeliusTransaction[]> {
  const {
    limit = 100,
    sortOrder = 'asc',
    skipCache = false
  } = options;

  const cacheKey = `txs:${address}:${limit}:${sortOrder}`;

  if (!skipCache) {
    const cached = getCached<HeliusTransaction[]>(cacheKey);
    if (cached) return cached;
  }

  // Single-step: Enhanced Transactions API returns parsed data directly
  // 1 API call instead of 2 (signatures + parse)
  const response = await fetchWithRetry(
    async () => {
      const key = await throttledGetKey();
      return `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&limit=${Math.min(limit, 100)}`;
    },
    { method: 'GET' }
  );

  const transactions: HeliusTransaction[] = await response.json();

  if (!Array.isArray(transactions)) {
    console.error('Unexpected response from Enhanced Transactions API:', transactions);
    setCache(cacheKey, []);
    return [];
  }

  // Sort by timestamp
  if (sortOrder === 'asc') {
    transactions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  } else {
    transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  setCache(cacheKey, transactions);
  return transactions;
}

/**
 * Get complete transaction history with pagination
 * Uses Enhanced Transactions API directly (1 call per page instead of 2)
 */
export async function getAllTransactionsForAddress(
  address: string,
  options: {
    maxPages?: number;
  } = {}
): Promise<HeliusTransaction[]> {
  const { maxPages = 10 } = options;

  const allTransactions: HeliusTransaction[] = [];
  let before: string | undefined;
  let page = 0;

  while (page < maxPages) {
    const response = await fetchWithRetry(
      async () => {
        const key = await throttledGetKey();
        const params = new URLSearchParams({ 'api-key': key, limit: '100' });
        if (before) params.set('before', before);
        return `https://api.helius.xyz/v0/addresses/${address}/transactions?${params}`;
      },
      { method: 'GET' }
    );

    const transactions: HeliusTransaction[] = await response.json();

    if (!Array.isArray(transactions) || transactions.length === 0) break;

    allTransactions.push(...transactions);
    before = transactions[transactions.length - 1].signature;
    page++;

    if (transactions.length < 100) break; // Last page

    if (page < maxPages) {
      // no delay — business+ handles burst
    }
  }

  // Sort chronologically (oldest first)
  return allTransactions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

// ============================================================================
// TOKEN HOLDER FETCHING
// ============================================================================

export async function getAllTokenHolders(mint: string, maxPages = 10): Promise<TokenHolder[]> {
  const cacheKey = `holders:${mint}`;
  const cached = getCached<TokenHolder[]>(cacheKey);
  if (cached) return cached;

  const holders: TokenHolder[] = [];
  let page = 1;

  while (page <= maxPages) {
    const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'getTokenAccounts',
        id: 'cabal-viz',
        params: {
          page,
          limit: 1000,
          mint
        }
      })
    });

    const data = await response.json();
    const result = data.result;

    if (!result?.token_accounts?.length) break;

    holders.push(...result.token_accounts.map((acc: { owner: string; amount: number; address?: string }) => ({
      owner: acc.owner,
      amount: acc.amount,
      tokenAccount: acc.address
    })));

    page++;

    // Delay between pages
    if (result.token_accounts.length === 1000) {
      // no delay — business+ handles burst
    }
  }

  setCache(cacheKey, holders);
  return holders;
}

// ============================================================================
// ENRICHED FUNDER DETECTION
// ============================================================================

// ============================================================================
// WALLET API — funded-by, identity, balances (Business+ tier)
// ============================================================================

interface WalletFundedByResponse {
  funder: string;
  funderName: string | null;
  funderType: string | null;
  mint: string;
  symbol: string;
  amount: number;
  amountRaw: string;
  decimals: number;
  date: string;
  signature: string;
  timestamp: number;
  slot: number;
}

/**
 * Get who funded a wallet — Wallet API (1 API call, no tx parsing needed)
 * Returns the first SOL transfer to the wallet
 */
/**
 * Get first funder for a wallet — uses Helius Wallet API /funded-by endpoint
 * Single REST call, server-side resolution of the TRUE first SOL transfer.
 * 100 credits per call. Falls back to RPC-based parsing if Wallet API fails.
 */
export async function getWalletFundedBy(address: string): Promise<EnrichedFunderInfo | null> {
  const cacheKey = `funded-by:${address}`;
  const cached = getCached<EnrichedFunderInfo | null>(cacheKey);
  if (cached !== null) return cached;

  try {
    // Primary: Wallet API /funded-by — 1 call, finds true first funder server-side
    const response = await fetchWithRetry(
      async () => {
        const key = await throttledGetKey();
        return `https://api.helius.xyz/v1/wallet/${address}/funded-by?api-key=${key}`;
      },
      { method: 'GET', maxRetries: 1 }
    );

    // 404 = no funding data found (normal for old/exchange wallets)
    if (!response.ok) {
      setCache(cacheKey, null);
      return null;
    }

    const data: WalletFundedByResponse = await response.json();
    if (!data.funder) {
      setCache(cacheKey, null);
      return null;
    }

    const result: EnrichedFunderInfo = {
      address: data.funder,
      amount: data.amount,
      timestamp: data.timestamp,
      txSignature: data.signature,
      txType: 'TRANSFER',
      txSource: data.funderType || 'UNKNOWN',
      viaDex: DEX_SOURCES.has((data.funderType || '').toUpperCase()),
      viaMixer: false,
    };
    setCache(cacheKey, result);
    return result;
  } catch {
    // Fallback: RPC-based — get earliest sig + parse it
    return getWalletFundedByRpc(address);
  }
}

/** RPC fallback for funded-by — paginate backwards to find true first tx */
async function getWalletFundedByRpc(address: string): Promise<EnrichedFunderInfo | null> {
  const cacheKey = `funded-by:${address}`;
  try {
    // Paginate getSignaturesForAddress backwards to find the actual oldest tx
    let before: string | undefined;
    let oldestSig: string | null = null;

    for (let page = 0; page < 5; page++) {
      const params: [string, { limit: number; before?: string }] = [address, { limit: 1000 }];
      if (before) params[1].before = before;

      const sigResponse = await fetchWithRetry(() => getThrottledRpcUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'get-oldest-sig',
          method: 'getSignaturesForAddress', params,
        }),
        maxRetries: 1,
      });

      const sigData = await sigResponse.json();
      const sigs = sigData.result || [];
      if (sigs.length === 0) break;

      oldestSig = sigs[sigs.length - 1].signature;
      before = oldestSig!;
      if (sigs.length < 1000) break; // Reached the end
    }

    if (!oldestSig) {
      setCache(cacheKey, null);
      return null;
    }

    // Parse the oldest signature
    const parseResponse = await fetchWithRetry(() => getThrottledApiUrl('/transactions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [oldestSig] }),
      maxRetries: 1,
    });

    const parsed: HeliusTransaction[] = await parseResponse.json();
    if (!Array.isArray(parsed) || parsed.length === 0) {
      setCache(cacheKey, null);
      return null;
    }

    const tx = parsed[0];
    if (tx.nativeTransfers) {
      for (const transfer of tx.nativeTransfers) {
        if (transfer.toUserAccount === address && transfer.amount > 0) {
          const result: EnrichedFunderInfo = {
            address: transfer.fromUserAccount,
            amount: transfer.amount / 1e9,
            timestamp: tx.timestamp,
            txSignature: tx.signature,
            txType: tx.type || 'TRANSFER',
            txSource: tx.source || 'UNKNOWN',
            viaDex: DEX_SOURCES.has(tx.source?.toUpperCase() || ''),
            viaMixer: false,
          };
          setCache(cacheKey, result);
          return result;
        }
      }
    }

    setCache(cacheKey, null);
    return null;
  } catch {
    setCache(cacheKey, null);
    return null;
  }
}

interface WalletIdentity {
  address: string;
  type: string | null;
  name: string | null;
  category: string | null;
  tags: string[];
}

/**
 * Batch identify wallets — Wallet API (up to 100 at once)
 */
export async function batchIdentifyWallets(addresses: string[]): Promise<Map<string, WalletIdentity>> {
  const results = new Map<string, WalletIdentity>();
  if (addresses.length === 0) return results;

  const batchSize = 100;
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);

    try {
      const response = await fetchWithRetry(
        async () => {
          const key = await throttledGetKey();
          return `https://api.helius.xyz/v1/wallet/batch-identity?api-key=${key}`;
        },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: batch }),
          maxRetries: 2,
        }
      );

      const identities: WalletIdentity[] = await response.json();
      if (Array.isArray(identities)) {
        for (const id of identities) {
          if (id.name) results.set(id.address, id);
        }
      }
    } catch (error) {
      console.error('Batch identity failed:', error);
    }
  }

  return results;
}

/**
 * Get first funders — uses Wallet API funded-by (1 call) with fallback to tx parsing
 */
export async function getFirstFunders(
  address: string,
  count: number = 3
): Promise<EnrichedFunderInfo[]> {
  // Try Wallet API first (1 call, instant)
  const fundedBy = await getWalletFundedBy(address);
  if (fundedBy) return [fundedBy];

  // Fallback: parse transactions manually
  const transactions = await getTransactionsForAddress(address, {
    limit: 20,
    sortOrder: 'asc'
  });

  const funders: EnrichedFunderInfo[] = [];
  const seenFunders = new Set<string>();

  for (const tx of transactions) {
    if (funders.length >= count) break;

    if (tx.nativeTransfers) {
      for (const transfer of tx.nativeTransfers) {
        if (transfer.toUserAccount === address && !seenFunders.has(transfer.fromUserAccount)) {
          seenFunders.add(transfer.fromUserAccount);
          funders.push({
            address: transfer.fromUserAccount,
            amount: transfer.amount / 1e9,
            timestamp: tx.timestamp,
            txSignature: tx.signature,
            txType: tx.type || 'UNKNOWN',
            txSource: tx.source || 'UNKNOWN',
            description: tx.description,
            viaDex: DEX_SOURCES.has(tx.source?.toUpperCase() || ''),
            viaMixer: MIXER_SOURCES.has(tx.source?.toUpperCase() || ''),
          });
        }
      }
    }
  }

  return funders.slice(0, count);
}

// ============================================================================
// WALLET PROFILE FORENSICS
// ============================================================================

/**
 * Build a forensic profile of a wallet
 */
export async function getWalletProfile(address: string): Promise<WalletProfile> {
  const cacheKey = `profile:${address}`;
  const cached = getCached<WalletProfile>(cacheKey);
  if (cached) return cached;

  const transactions = await getAllTransactionsForAddress(address, { maxPages: 5 });

  if (transactions.length === 0) {
    const emptyProfile: WalletProfile = {
      address,
      totalTxCount: 0,
      walletAgeDays: 0,
      isFreshWallet: true,
      totalSolReceived: 0,
      totalSolSent: 0,
      uniqueInteractions: 0,
      dexActivity: false,
      suspiciousPatterns: ['No transaction history'],
    };
    setCache(cacheKey, emptyProfile);
    return emptyProfile;
  }

  const firstTx = transactions[0];
  const lastTx = transactions[transactions.length - 1];
  const walletAgeDays = Math.floor((Date.now() / 1000 - firstTx.timestamp) / 86400);

  let totalSolReceived = 0;
  let totalSolSent = 0;
  const uniqueAddresses = new Set<string>();
  let dexActivity = false;
  const suspiciousPatterns: string[] = [];

  for (const tx of transactions) {
    // Check for DEX activity
    if (DEX_SOURCES.has(tx.source?.toUpperCase() || '')) {
      dexActivity = true;
    }

    // Track transfers
    if (tx.nativeTransfers) {
      for (const transfer of tx.nativeTransfers) {
        if (transfer.toUserAccount === address) {
          totalSolReceived += transfer.amount / 1e9;
          uniqueAddresses.add(transfer.fromUserAccount);
        }
        if (transfer.fromUserAccount === address) {
          totalSolSent += transfer.amount / 1e9;
          uniqueAddresses.add(transfer.toUserAccount);
        }
      }
    }
  }

  // Detect suspicious patterns
  if (walletAgeDays < 7) {
    suspiciousPatterns.push('Fresh wallet (< 7 days old)');
  }
  if (transactions.length < 5 && totalSolReceived > 10) {
    suspiciousPatterns.push('Large funding with minimal activity');
  }
  if (uniqueAddresses.size < 3 && transactions.length > 10) {
    suspiciousPatterns.push('Limited address diversity');
  }

  const profile: WalletProfile = {
    address,
    firstTxTimestamp: firstTx.timestamp,
    lastTxTimestamp: lastTx.timestamp,
    totalTxCount: transactions.length,
    walletAgeDays,
    isFreshWallet: walletAgeDays < 7,
    totalSolReceived,
    totalSolSent,
    uniqueInteractions: uniqueAddresses.size,
    dexActivity,
    suspiciousPatterns,
  };

  setCache(cacheKey, profile);
  return profile;
}

// ============================================================================
// TOKEN SECURITY ANALYSIS
// ============================================================================

export async function getAsset(address: string): Promise<HeliusAsset | null> {
  const cacheKey = `asset:${address}`;
  const cached = getCached<HeliusAsset | null>(cacheKey);
  if (cached !== null) return cached;

  try {
    const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-asset',
        method: 'getAsset',
        params: { id: address }
      })
    });

    const data = await response.json();
    if (data.error) {
      setCache(cacheKey, null);
      return null;
    }

    const asset = data.result as HeliusAsset;
    setCache(cacheKey, asset);
    return asset;
  } catch {
    return null;
  }
}

/**
 * Get comprehensive security info for a token
 */
export async function getTokenSecurity(mintAddress: string): Promise<TokenSecurityInfo | null> {
  const cacheKey = `security:${mintAddress}`;
  const cached = getCached<TokenSecurityInfo | null>(cacheKey);
  if (cached !== null) return cached;

  const asset = await getAsset(mintAddress);
  if (!asset) return null;

  const riskFactors: string[] = [];
  let riskLevel: TokenSecurityInfo['riskLevel'] = 'low';

  // Check freeze authority
  const freezeAuthority = asset.authorities?.find(a =>
    a.scopes.includes('freeze') || a.scopes.includes('full')
  );
  const hasFreezeAuthority = !!freezeAuthority;

  // Check mint authority
  const mintAuthority = asset.authorities?.find(a =>
    a.scopes.includes('mint') || a.scopes.includes('full')
  );
  const hasMintAuthority = !!mintAuthority;

  // Check mutability
  const isMutable = asset.mutable ?? false;

  // Calculate risk level based on all factors
  if (hasFreezeAuthority && hasMintAuthority) {
    riskLevel = 'critical';
    riskFactors.push('CRITICAL: Both freeze and mint authorities active');
  } else if (hasFreezeAuthority || hasMintAuthority) {
    riskLevel = 'high';
  } else if (isMutable) {
    riskLevel = 'medium';
  }

  // Add individual risk factors
  if (hasFreezeAuthority) {
    riskFactors.push('Freeze authority enabled - tokens can be frozen');
  }
  if (hasMintAuthority) {
    riskFactors.push('Mint authority enabled - supply can be inflated');
  }
  if (isMutable) {
    riskFactors.push('Metadata is mutable - token identity can change');
  }

  const security: TokenSecurityInfo = {
    hasFreezeAuthority,
    freezeAuthority: freezeAuthority?.address,
    hasMintAuthority,
    mintAuthority: mintAuthority?.address,
    isMutable,
    supply: asset.token_info?.supply,
    decimals: asset.token_info?.decimals,
    riskLevel,
    riskFactors,
  };

  setCache(cacheKey, security);
  return security;
}

export async function isTokenMint(address: string): Promise<boolean> {
  const asset = await getAsset(address);

  if (!asset) {
    return false;
  }

  const fungibleInterfaces = [
    'FungibleToken',
    'FungibleAsset',
    'V1_TOKEN',
  ];

  return fungibleInterfaces.includes(asset.interface);
}

// ============================================================================
// BALANCE FETCHING
// ============================================================================

export async function getAccountBalance(address: string): Promise<number> {
  const cacheKey = `balance:${address}`;
  const cached = getCached<number>(cacheKey);
  if (cached !== null) return cached;

  const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'balance',
      method: 'getBalance',
      params: [address]
    })
  });

  const data = await response.json();
  const balance = (data.result?.value || 0) / 1e9;
  setCache(cacheKey, balance);
  return balance;
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Batch fetch assets for multiple addresses
 */
export async function getAssetBatch(addresses: string[]): Promise<Map<string, HeliusAsset | null>> {
  const results = new Map<string, HeliusAsset | null>();
  const uncached: string[] = [];

  // Check cache first
  for (const addr of addresses) {
    const cached = getCached<HeliusAsset | null>(`asset:${addr}`);
    if (cached !== null) {
      results.set(addr, cached);
    } else {
      uncached.push(addr);
    }
  }

  if (uncached.length === 0) return results;

  // Fetch uncached in batches of 100
  const batchSize = 100;
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize);

    try {
      const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-asset-batch',
          method: 'getAssetBatch',
          params: { ids: batch }
        })
      });

      const data = await response.json();

      if (data.result) {
        for (const asset of data.result) {
          if (asset && asset.id) {
            results.set(asset.id, asset);
            setCache(`asset:${asset.id}`, asset);
          }
        }
      }

      // Mark unfound as null
      for (const addr of batch) {
        if (!results.has(addr)) {
          results.set(addr, null);
          setCache(`asset:${addr}`, null);
        }
      }
    } catch (error) {
      console.error('Batch asset fetch failed:', error);
      for (const addr of batch) {
        results.set(addr, null);
      }
    }

    if (i + batchSize < uncached.length) {
      // no delay — business+ handles burst
    }
  }

  return results;
}

// ============================================================================
// SNIPER DETECTION - Get token launch time and early buyers
// ============================================================================

interface TokenLaunchInfo {
  mintTimestamp: number;
  mintSlot: number;
  mintSignature: string;
}

/**
 * Get when a token was created/minted - LIGHTWEIGHT version using signatures only
 */
export async function getTokenLaunchInfo(mintAddress: string): Promise<TokenLaunchInfo | null> {
  const cacheKey = `launch:${mintAddress}`;
  const cached = getCached<TokenLaunchInfo | null>(cacheKey);
  if (cached !== null) return cached;

  try {
    // Use signatures-only mode (1 API call instead of 2)
    // Use 'before' parameter to paginate backwards to find oldest
    const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-launch-sigs',
        method: 'getSignaturesForAddress',
        params: [
          mintAddress,
          { limit: 100 }  // Enough to find the oldest (creation) tx
        ]
      })
    });

    const data = await response.json();
    const signatures = data.result || [];

    if (signatures.length === 0) {
      setCache(cacheKey, null);
      return null;
    }

    // Signatures come in descending order (newest first)
    // So the LAST one is the oldest (token creation)
    const oldestSig = signatures[signatures.length - 1];
    const launchInfo: TokenLaunchInfo = {
      mintTimestamp: oldestSig.blockTime || 0,
      mintSlot: oldestSig.slot,
      mintSignature: oldestSig.signature,
    };

    console.log(`Token ${mintAddress.slice(0,8)}... created at slot ${launchInfo.mintSlot}`);
    setCache(cacheKey, launchInfo);
    return launchInfo;
  } catch (error) {
    console.error(`Error getting launch info for ${mintAddress}:`, error);
    return null;
  }
}

interface WalletBuyInfo {
  firstBuyTimestamp: number;
  firstBuySlot: number;
  firstBuySignature: string;
  blocksAfterLaunch: number;
  secondsAfterLaunch: number;
}

/**
 * Check if wallet is a sniper using EXISTING transaction data
 * This avoids extra API calls by reusing already-fetched transactions
 */
export function checkSniperFromTransactions(
  transactions: HeliusTransaction[],
  walletAddress: string,
  mintAddress: string,
  launchSlot: number,
  launchTimestamp: number
): WalletBuyInfo | null {
  // Find first transaction involving this token
  for (const tx of transactions) {
    // Check token transfers
    if (tx.tokenTransfers) {
      const relevantTransfer = tx.tokenTransfers.find(
        t => t.mint === mintAddress && t.toUserAccount === walletAddress
      );
      if (relevantTransfer) {
        return {
          firstBuyTimestamp: tx.timestamp,
          firstBuySlot: tx.slot,
          firstBuySignature: tx.signature,
          blocksAfterLaunch: tx.slot - launchSlot,
          secondsAfterLaunch: tx.timestamp - launchTimestamp,
        };
      }
    }

    // Also check account data for token balance changes
    if (tx.accountData) {
      for (const acc of tx.accountData) {
        const tokenChange = acc.tokenBalanceChanges?.find(
          t => t.mint === mintAddress && t.userAccount === walletAddress
        );
        if (tokenChange && parseInt(tokenChange.rawTokenAmount.tokenAmount) > 0) {
          return {
            firstBuyTimestamp: tx.timestamp,
            firstBuySlot: tx.slot,
            firstBuySignature: tx.signature,
            blocksAfterLaunch: tx.slot - launchSlot,
            secondsAfterLaunch: tx.timestamp - launchTimestamp,
          };
        }
      }
    }
  }

  return null;
}

// ============================================================================
// BATCH EARLY TX FETCHING — For sniper + bundle detection
// ============================================================================

/**
 * Fetch first few transactions for multiple wallets in parallel via Enhanced API.
 * Uses sort-order=asc to get oldest txs first (finds buys near launch).
 * All calls fire in parallel — Business+ handles burst.
 */
export async function batchGetEarlyTransactions(
  addresses: string[],
  limit: number = 5
): Promise<Map<string, HeliusTransaction[]>> {
  const results = new Map<string, HeliusTransaction[]>();

  const fetches = addresses.map(async (address) => {
    const cacheKey = `early-txs:${address}:${limit}`;
    const cached = getCached<HeliusTransaction[]>(cacheKey);
    if (cached) {
      results.set(address, cached);
      return;
    }

    try {
      const response = await fetchWithRetry(
        async () => {
          const key = await throttledGetKey();
          return `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&limit=${limit}`;
        },
        { method: 'GET', maxRetries: 1 }
      );

      const txs: HeliusTransaction[] = await response.json();
      if (Array.isArray(txs)) {
        // Sort ascending (oldest first)
        txs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setCache(cacheKey, txs);
        results.set(address, txs);
      }
    } catch {
      results.set(address, []);
    }
  });

  await Promise.all(fetches);
  return results;
}

// ============================================================================
// WALLET API — Balances & Transfers
// ============================================================================

export interface WalletBalance {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  pricePerToken: number;
  usdValue: number;
  logoUri?: string;
}

export interface WalletBalancesResponse {
  balances: WalletBalance[];
  totalUsdValue: number;
}

/**
 * Get wallet portfolio — token holdings with USD values
 */
export async function getWalletBalances(address: string): Promise<WalletBalancesResponse | null> {
  const cacheKey = `balances:${address}`;
  const cached = getCached<WalletBalancesResponse>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithRetry(
      async () => {
        const key = await throttledGetKey();
        return `https://api.helius.xyz/v1/wallet/${address}/balances?api-key=${key}&showNative=true&limit=20`;
      },
      { method: 'GET', maxRetries: 2 }
    );

    const data = await response.json();
    if (!data.balances) return null;

    const result: WalletBalancesResponse = {
      balances: data.balances,
      totalUsdValue: data.totalUsdValue || 0,
    };

    setCache(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

export interface WalletTransfer {
  signature: string;
  timestamp: number;
  direction: 'in' | 'out';
  counterparty: string;
  mint: string;
  symbol: string | null;
  amount: number;
  amountRaw: string;
  decimals: number;
}

export interface WalletTransfersResponse {
  data: WalletTransfer[];
  pagination: { hasMore: boolean; nextCursor?: string };
}

/**
 * Get all transfers for a wallet — incoming and outgoing with counterparty info
 * Perfect for building funding chain graphs
 */
export async function getWalletTransfers(
  address: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<WalletTransfersResponse | null> {
  const { limit = 100, cursor } = options;

  try {
    const response = await fetchWithRetry(
      async () => {
        const key = await throttledGetKey();
        const params = new URLSearchParams({ 'api-key': key, limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        return `https://api.helius.xyz/v1/wallet/${address}/transfers?${params}`;
      },
      { method: 'GET', maxRetries: 2 }
    );

    const data: WalletTransfersResponse = await response.json();
    return data;
  } catch {
    return null;
  }
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export { sleep };

export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
