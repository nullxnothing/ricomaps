import {
  HeliusTransaction,
  TokenHolder,
  HeliusAsset,
  TokenSecurityInfo,
  EnrichedFunderInfo,
} from './types';

function cleanEnvValue(value: string | undefined): string | null {
  const cleaned = value?.trim().replace(/^['"]|['"]$/g, '').replace(/\\r\\n$/g, '').trim();
  return cleaned || null;
}

// Dedicated node / project RPC. Support both the old local name and the Vercel env name.
const DEDICATED_RPC_URL = cleanEnvValue(process.env.HELIUS_DEDICATED_RPC) || cleanEnvValue(process.env.HELIUS_RPC_URL) || '';
const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com/';
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// API keys for Wallet API / Enhanced Transactions API (still need keys)
const API_KEYS = [
  process.env.HELIUS_API_KEY,
  process.env.HELIUS_API_KEY_2,
  process.env.HELIUS_API_KEY_3,
  process.env.HELIUS_API_KEY_4,
].map(cleanEnvValue).filter((key): key is string => Boolean(key));
const exhaustedKeys = new Set<string>();

// RPC URL: use dedicated node if available (faster, no rate limits), fallback to keyed
// Throttled URL resolvers
// RPC: dedicated node (no throttle needed) or keyed fallback
async function getThrottledRpcUrl(): Promise<string> {
  if (DEDICATED_RPC_URL) return DEDICATED_RPC_URL; // No throttle: dedicated node has no rate limit
  const key = await throttledGetKey();
  return `${HELIUS_RPC_BASE}?api-key=${key}`;
}

// API: always needs a key (Wallet API, Enhanced Transactions)
async function getThrottledApiUrl(endpoint: string): Promise<string> {
  const key = await throttledGetKey();
  return `https://api-mainnet.helius-rpc.com/v0${endpoint}?api-key=${key}`;
}

// Known DEX and mixer sources for forensic detection
const DEX_SOURCES = new Set([
  'JUPITER', 'RAYDIUM', 'ORCA', 'SERUM', 'OPENBOOK', 'PHOENIX',
  'LIFINITY', 'METEORA', 'PUMP_FUN', 'MOONSHOT'
]);

// ============================================================================
// CACHING LAYER - Simple in-memory cache with TTL
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const CACHE_SENTINEL = Symbol('CACHE_NULL');
type CacheStored<T> = T | typeof CACHE_SENTINEL;

const MAX_CACHE_SIZE = 2000;
const cache = new Map<string, CacheEntry<unknown>>();

const CACHE_TTLS = {
  security: 1 * 60 * 60 * 1000,
  holders: 15 * 1000,
  transactions: 4 * 60 * 60 * 1000,
  profiles: 1 * 60 * 60 * 1000,
  transfers: 5 * 60 * 1000,
  default: 2 * 60 * 60 * 1000,
};

function getTtlForKey(key: string): number {
  if (key.startsWith('security:')) return CACHE_TTLS.security;
  if (key.startsWith('holders:')) return CACHE_TTLS.holders;
  if (key.startsWith('txs:')) return CACHE_TTLS.transactions;
  if (key.startsWith('profile:')) return CACHE_TTLS.profiles;
  if (key.startsWith('transfers:')) return CACHE_TTLS.transfers;
  if (key.startsWith('wallet-history:')) return 2 * 60 * 1000;
  return CACHE_TTLS.default;
}

function getCached<T>(key: string): { hit: true; value: T } | { hit: false } {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return { hit: false };
  }
  cache.delete(key);
  cache.set(key, entry);
  const stored = entry.data as CacheStored<T>;
  return { hit: true, value: stored === CACHE_SENTINEL ? null as T : stored as T };
}

function setCache<T>(key: string, data: T): void {
  if (cache.size >= MAX_CACHE_SIZE && !cache.has(key)) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  const stored = data === null ? CACHE_SENTINEL : data;
  cache.set(key, { data: stored, timestamp: Date.now(), ttl: getTtlForKey(key) });
}

const SWEEP_INTERVAL = 5 * 60 * 1000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startCacheSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.timestamp > entry.ttl) cache.delete(key);
    }
  }, SWEEP_INTERVAL);
  if (typeof sweepTimer === 'object' && 'unref' in sweepTimer) {
    sweepTimer.unref();
  }
}

startCacheSweep();

const g = globalThis as Record<string, unknown>;
if (typeof g.__helius_sweep_cleanup === 'function') {
  (g.__helius_sweep_cleanup as () => void)();
}
g.__helius_sweep_cleanup = () => {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
};

// ============================================================================
// RETRY LOGIC WITH PER-KEY RATE LIMITING + CIRCUIT BREAKER
// ============================================================================

// Per-key rate tracking. Override for higher Helius plans with HELIUS_REQUESTS_PER_SECOND.
const REQUESTS_PER_SECOND = Math.max(1, Number(process.env.HELIUS_REQUESTS_PER_SECOND ?? 10));
const PER_KEY_INTERVAL = Math.ceil(1000 / REQUESTS_PER_SECOND);
const keyLastRequestTime = new Map<string, number>();

// Circuit breaker
let consecutiveFailures = 0;
let circuitBreakerTripped = false;
let circuitBreakerResetTime = 0;
const MAX_CONSECUTIVE_FAILURES = 15;
const CIRCUIT_BREAKER_RESET_MS = 10000;

function checkCircuitBreaker(): boolean {
  if (!circuitBreakerTripped) return true;

  if (Date.now() > circuitBreakerResetTime) {
    circuitBreakerTripped = false;
    consecutiveFailures = 0;
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
  if (API_KEYS.length === 0) {
    throw new Error('No Helius API keys configured');
  }

  const availableKeys = API_KEYS.filter(key => !exhaustedKeys.has(key));
  if (availableKeys.length === 0) {
    throw new Error('All Helius API keys are exhausted or unavailable');
  }

  const now = Date.now();
  let bestKey = availableKeys[0];
  let bestWait = Infinity;

  for (const key of availableKeys) {
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

function sanitizeUrl(url: string): string {
  return url
    .replace(/([?&])api-key=[^&]*/gi, '$1api-key=***')
    .replace(/(\/api-key\/)[^/?]*/gi, '$1***');
}

// Must stay well under the smallest route budget (quick-scan = 30s) so a single
// hung upstream call aborts and retries inside the function's lifetime instead of
// consuming the whole 30s and forcing a 504. 12s leaves room for a retry + the
// rest of the request.
const FETCH_TIMEOUT_MS = 12_000;

interface FetchOptions extends RequestInit {
  maxRetries?: number;
  baseDelay?: number;
  allowedStatuses?: number[];
}

async function fetchWithRetry(url: string | (() => Promise<string>), options: FetchOptions = {}): Promise<Response> {
  const { maxRetries = 3, baseDelay = 3000, allowedStatuses = [], ...fetchOptions } = options;
  let lastError: Error | null = null;

  if (!checkCircuitBreaker()) {
    throw new Error('Circuit breaker active - API temporarily disabled');
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      // Resolve URL (may involve per-key throttling)
      const resolvedUrl = typeof url === 'function' ? await url() : url;

      const response = await fetch(resolvedUrl, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutId);

      if (allowedStatuses.includes(response.status)) {
        recordSuccess();
        return response;
      }

      // Handle rate limiting: mark this key as cooling off and retry with a different key
      if (response.status === 429) {
        const body = await response.clone().text().catch(() => '');
        const keyMatch = resolvedUrl.match(/api-key=([^&]+)/);
        if (/max usage reached/i.test(body) && keyMatch) {
          exhaustedKeys.add(keyMatch[1]);
        }
        const retryAfter = response.headers.get('Retry-After');
        const cooldown = retryAfter ? parseInt(retryAfter) * 1000 : baseDelay * Math.pow(2, attempt);
        // Cool off the key that was just used so acquireKey() picks a different one
        if (keyMatch) keyLastRequestTime.set(keyMatch[1], Date.now() + cooldown);
        console.warn(`Rate limited (attempt ${attempt + 1}/${maxRetries}). Waiting ${Math.min(cooldown, 2000)}ms...`);
        await sleep(Math.min(cooldown, 2000));
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
        const errorBody = (await response.text()).replace(/api-key=[^&\s"']*/gi, 'api-key=***');
        throw new Error(`Helius API error ${response.status}: ${errorBody}`);
      }

      // Success! Reset circuit breaker counter
      recordSuccess();
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;
      recordFailure();
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        // Surface the actual reason (abort/timeout vs. network vs. DNS) — a bare
        // "Request failed" gave log scans nothing to act on.
        const reason = lastError.name === 'AbortError'
          ? `timeout after ${FETCH_TIMEOUT_MS}ms`
          : sanitizeUrl(lastError.message);
        console.warn(`Request failed (attempt ${attempt + 1}/${maxRetries}): ${reason}. Waiting ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  if (lastError) {
    lastError.message = sanitizeUrl(lastError.message);
    throw lastError;
  }
  throw new Error('Request failed after max retries');
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
    if (cached.hit) return cached.value;
  }

  // Single-step: Enhanced Transactions API returns parsed data directly
  // 1 API call instead of 2 (signatures + parse)
    const response = await fetchWithRetry(
      async () => {
        const key = await throttledGetKey();
        return `https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?api-key=${key}&limit=${Math.min(limit, 100)}`;
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
        if (before) params.set('before-signature', before);
        return `https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?${params}`;
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
      // no delay: business+ handles burst
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
  if (cached.hit) return cached.value;

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
      // no delay: business+ handles burst
    }
  }

  setCache(cacheKey, holders);
  return holders;
}

// ============================================================================
// ENRICHED FUNDER DETECTION
// ============================================================================

// ============================================================================
// WALLET API: funded-by, identity, balances (Business+ tier)
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
 * Get who funded a wallet, Wallet API (1 API call, no tx parsing needed)
 * Returns the first SOL transfer to the wallet
 */
/**
 * Get first funder for a wallet, uses Helius Wallet API /funded-by endpoint
 * Single REST call, server-side resolution of the TRUE first SOL transfer.
 * 100 credits per call. Falls back to RPC-based parsing if Wallet API fails.
 */
export async function getWalletFundedBy(address: string): Promise<EnrichedFunderInfo | null> {
  const cacheKey = `funded-by:${address}`;
  const cached = getCached<EnrichedFunderInfo | null>(cacheKey);
  if (cached.hit) return cached.value;

  try {
    // Primary: Wallet API /funded-by: 1 call, finds true first funder server-side
    const response = await fetchWithRetry(
      async () => {
        const key = await throttledGetKey();
        return `https://api.helius.xyz/v1/wallet/${address}/funded-by?api-key=${key}`;
      },
      { method: 'GET', maxRetries: 1, allowedStatuses: [404] }
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
    // Fallback: RPC-based, get earliest sig + parse it
    return getWalletFundedByRpc(address);
  }
}

/** RPC fallback for funded-by: paginate backwards to find true first tx */
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
 * Batch identify wallets, Wallet API (up to 100 at once)
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

// ============================================================================
// TOKEN SECURITY ANALYSIS
// ============================================================================

export async function getAsset(address: string): Promise<HeliusAsset | null> {
  const cacheKey = `asset:${address}`;
  const cached = getCached<HeliusAsset | null>(cacheKey);
  if (cached.hit) return cached.value;

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
      return null;
    }

    if (!data.result) {
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
 * Count fungible tokens created by an address via DAS searchAssets.
 * Used for serial-deployer detection. ~10 credits. Returns null on error.
 * NOTE: only meaningful for a human signer: querying a program/PDA creator
 * returns thousands of unrelated tokens (callers must filter those out first).
 */
export async function searchAssetsByCreator(
  creator: string,
  opts: { limit?: number } = {},
): Promise<{ count: number; sample: string[] } | null> {
  const limit = opts.limit ?? 50;
  const cacheKey = `search-creator:${creator}:${limit}`;
  const cached = getCached<{ count: number; sample: string[] } | null>(cacheKey);
  if (cached.hit) return cached.value;

  try {
    const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // NOTE: `tokenType` requires `ownerAddress`; for a creator-wide search we
      // omit it and count fungible results client-side instead.
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'search-creator',
        method: 'searchAssets',
        params: { creatorAddress: creator, page: 1, limit },
      }),
    });

    const data = await response.json();
    if (data.error || !data.result) {
      setCache(cacheKey, null);
      return null;
    }

    const items = (data.result.items ?? []) as { id?: string; interface?: string }[];
    // Count fungible tokens (FungibleToken / FungibleAsset); ignore NFTs.
    const fungible = items.filter(i => i.interface?.startsWith('Fungible'));
    const result = {
      count: fungible.length,
      sample: fungible.map(i => i.id).filter((id): id is string => Boolean(id)).slice(0, 10),
    };
    setCache(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Extract the fee payer (signer) of a gTFA transaction: accountKeys[0].
 * For a token's first mint tx this is the true deployer/dev, even when the
 * on-chain creator/authority is the pump.fun program.
 */
export function getMintTxSigner(tx: GtfaTransaction): string {
  const msg = getGtfaMessage(tx);
  const keys = msg.message?.accountKeys ?? [];
  return keys.length > 0 ? getRawAccountKey(keys[0]) : '';
}

/**
 * Get comprehensive security info for a token
 */
export async function getTokenSecurity(mintAddress: string): Promise<TokenSecurityInfo | null> {
  const cacheKey = `security:${mintAddress}`;
  const cached = getCached<TokenSecurityInfo | null>(cacheKey);
  if (cached.hit) return cached.value;

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

/**
 * UI-unit balance of a single mint for one owner (1 RPC credit).
 * Used by the token gate, far cheaper than the full /balances portfolio call.
 * Sums across all token accounts the owner holds for the mint.
 */
export async function getTokenBalanceForMint(owner: string, mint: string): Promise<number> {
  try {
    const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'gate-balance',
        method: 'getTokenAccountsByOwner',
        params: [owner, { mint }, { encoding: 'jsonParsed' }],
      }),
    });
    const data = await response.json();
    const accounts = data.result?.value ?? [];
    let total = 0;
    for (const acc of accounts) {
      const amount = acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof amount === 'number') total += amount;
    }
    return total;
  } catch (error) {
    console.error('[Gate] balance check failed:', error);
    return 0;
  }
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
  if (cached.hit) return cached.value;

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

type RawAccountKey = string | { pubkey?: string };
type GtfaMessage = { message?: { accountKeys?: unknown[] }; signatures?: string[] };

function getRawAccountKey(key: RawAccountKey | unknown): string {
  if (typeof key === 'string') return key;
  if (key && typeof key === 'object' && 'pubkey' in key) {
    const pubkey = (key as { pubkey?: unknown }).pubkey;
    return typeof pubkey === 'string' ? pubkey : '';
  }
  return '';
}

function getGtfaMessage(tx: GtfaTransaction): GtfaMessage {
  const parsed = tx.transaction as GtfaMessage;
  return parsed?.message ? parsed : {};
}

function convertGtfaToHeliusTransaction(tx: GtfaTransaction): HeliusTransaction {
  const meta = tx.meta;
  const msg = getGtfaMessage(tx);
  const keys = msg.message?.accountKeys ?? [];
  const signature = msg.signatures?.[0] ?? '';
  const nativeTransfers: { fromUserAccount: string; toUserAccount: string; amount: number }[] = [];

  if (meta && keys.length > 0) {
    const pre = (meta as { preBalances?: number[] }).preBalances ?? [];
    const post = (meta as { postBalances?: number[] }).postBalances ?? [];
    let senderIdx = -1;
    let senderDiff = 0;

    for (let i = 0; i < keys.length && i < pre.length && i < post.length; i++) {
      const diff = post[i] - pre[i];
      if (diff < senderDiff) {
        senderDiff = diff;
        senderIdx = i;
      }
    }

    if (senderIdx >= 0) {
      const fromKey = getRawAccountKey(keys[senderIdx]);
      for (let i = 0; i < keys.length && i < pre.length && i < post.length; i++) {
        const diff = post[i] - pre[i];
        const toKey = getRawAccountKey(keys[i]);
        if (diff > 0 && fromKey && toKey && fromKey !== toKey) {
          nativeTransfers.push({ fromUserAccount: fromKey, toUserAccount: toKey, amount: diff });
        }
      }
    }
  }

  const preTokenByAccount = new Map<string, TokenBalanceEntry>();
  for (const entry of meta?.preTokenBalances ?? []) {
    preTokenByAccount.set(`${entry.accountIndex}:${entry.mint}`, entry);
  }

  const accountDataByOwner = new Map<string, HeliusTransaction['accountData'][number]>();
  const tokenTransfers: HeliusTransaction['tokenTransfers'] = [];

  for (const postEntry of meta?.postTokenBalances ?? []) {
    if (!postEntry.owner) continue;

    const preEntry = preTokenByAccount.get(`${postEntry.accountIndex}:${postEntry.mint}`);
    const postRaw = BigInt(postEntry.uiTokenAmount.amount || '0');
    const preRaw = BigInt(preEntry?.uiTokenAmount.amount || '0');
    const deltaRaw = postRaw - preRaw;
    if (deltaRaw <= BigInt(0)) continue;

    const decimals = postEntry.uiTokenAmount.decimals;
    const tokenAmount = Number(deltaRaw) / Math.pow(10, decimals);
    const tokenAccount = getRawAccountKey(keys[postEntry.accountIndex]);

    tokenTransfers.push({
      fromUserAccount: '',
      toUserAccount: postEntry.owner,
      mint: postEntry.mint,
      tokenAmount,
      tokenStandard: 'Fungible',
    });

    const accountData = accountDataByOwner.get(postEntry.owner) ?? {
      account: postEntry.owner,
      nativeBalanceChange: 0,
      tokenBalanceChanges: [],
    };
    accountData.tokenBalanceChanges.push({
      mint: postEntry.mint,
      tokenAccount,
      userAccount: postEntry.owner,
      rawTokenAmount: {
        tokenAmount: deltaRaw.toString(),
        decimals,
      },
    });
    accountDataByOwner.set(postEntry.owner, accountData);
  }

  return {
    signature,
    timestamp: tx.blockTime ?? 0,
    slot: tx.slot,
    type: 'UNKNOWN',
    source: 'GTFA',
    fee: Number((meta as { fee?: number } | null)?.fee ?? 0),
    feePayer: getRawAccountKey(keys[0]),
    nativeTransfers,
    tokenTransfers,
    accountData: Array.from(accountDataByOwner.values()),
    description: '',
  };
}

// ============================================================================
// BATCH EARLY TX FETCHING: For sniper + bundle detection
// ============================================================================

/**
 * Fetch first few transactions for multiple wallets in parallel via Enhanced API.
 * Uses sort-order=asc to get oldest txs first (finds buys near launch).
 * All calls fire in parallel: Business+ handles burst.
 */
export async function batchGetEarlyTransactions(
  addresses: string[],
  limit: number = 5
): Promise<Map<string, HeliusTransaction[]>> {
  const results = new Map<string, HeliusTransaction[]>();
  const uncached: string[] = [];

  // Check cache first
  for (const address of addresses) {
    const cacheKey = `early-txs:${address}:${limit}`;
    const cached = getCached<HeliusTransaction[]>(cacheKey);
    if (cached.hit) {
      results.set(address, cached.value);
    } else {
      uncached.push(address);
    }
  }

  if (uncached.length === 0) return results;

  // Fire all gTFA calls in parallel: dedicated RPC has no rate limit
  const fetches = uncached.map(async (address) => {
    try {
      const gtfa = await getTransactionsForAddressGtfa(address, {
        sortOrder: 'asc',
        limit: Math.min(limit, 100),
        status: 'succeeded',
        tokenAccounts: 'balanceChanged',
      });

      const txs = gtfa.data;
      if (!Array.isArray(txs) || txs.length === 0) {
        results.set(address, []);
        return;
      }

      const converted = txs.map(convertGtfaToHeliusTransaction);

      const cacheKey = `early-txs:${address}:${limit}`;
      setCache(cacheKey, converted);
      results.set(address, converted);
    } catch {
      results.set(address, []);
    }
  });

  await Promise.all(fetches);

  for (const address of uncached) {
    if (!results.has(address)) results.set(address, []);
  }

  return results;
}

// ============================================================================
// WALLET API: Balances & Transfers
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
 * Get wallet portfolio: token holdings with USD values
 */
export async function getWalletBalances(address: string): Promise<WalletBalancesResponse | null> {
  const cacheKey = `balances:${address}`;
  const cached = getCached<WalletBalancesResponse>(cacheKey);
  if (cached.hit) return cached.value;

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
  slot?: number;
  type?: 'transfer' | 'mint' | 'burn' | 'wrap' | 'unwrap' | 'changeOwner' | 'withdrawWithheldFee';
  direction: 'in' | 'out';
  counterparty: string;
  mint: string;
  symbol: string | null;
  amount: number;
  amountRaw: string;
  decimals: number;
  feeAmount?: string;
  feeUiAmount?: string;
  confirmationStatus?: string;
}

export interface WalletTransfersResponse {
  data: WalletTransfer[];
  pagination: { hasMore: boolean; nextCursor?: string };
}

interface GetTransfersByAddressRow {
  signature: string;
  slot: number;
  blockTime: number;
  type: WalletTransfer['type'];
  fromUserAccount: string | null;
  toUserAccount: string | null;
  mint: string;
  amount: string;
  decimals: number;
  uiAmount?: string;
  feeAmount?: string;
  feeUiAmount?: string;
  confirmationStatus?: string;
}

interface TransferComparisonFilter {
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

interface GetWalletTransfersOptions {
  limit?: number;
  cursor?: string;
  direction?: 'in' | 'out' | 'any';
  with?: string;
  mint?: string;
  solMode?: 'merged' | 'separate';
  sortOrder?: 'asc' | 'desc';
  commitment?: 'confirmed' | 'finalized';
  filters?: {
    amount?: TransferComparisonFilter;
    blockTime?: TransferComparisonFilter;
    slot?: TransferComparisonFilter;
  };
}

function uiAmountFromRaw(rawAmount: string, decimals: number): number {
  const raw = Number(rawAmount);
  if (!Number.isFinite(raw)) return 0;
  return raw / Math.pow(10, decimals);
}

function normalizeTransferRow(address: string, row: GetTransfersByAddressRow): WalletTransfer | null {
  const direction = row.toUserAccount === address ? 'in' : row.fromUserAccount === address ? 'out' : null;
  if (!direction) return null;

  const counterparty = direction === 'in' ? row.fromUserAccount : row.toUserAccount;
  if (!counterparty) return null;

  const amount = row.uiAmount !== undefined ? Number(row.uiAmount) : uiAmountFromRaw(row.amount, row.decimals);
  if (!Number.isFinite(amount)) return null;

  return {
    signature: row.signature,
    timestamp: row.blockTime,
    slot: row.slot,
    type: row.type,
    direction,
    counterparty,
    mint: row.mint,
    symbol: row.mint === NATIVE_SOL_MINT ? 'SOL' : row.mint === WSOL_MINT ? 'WSOL' : null,
    amount,
    amountRaw: row.amount,
    decimals: row.decimals,
    feeAmount: row.feeAmount,
    feeUiAmount: row.feeUiAmount,
    confirmationStatus: row.confirmationStatus,
  };
}

/**
 * Get all transfers for a wallet: incoming and outgoing with counterparty info
 * Perfect for building funding chain graphs
 */
export async function getWalletTransfers(
  address: string,
  options: GetWalletTransfersOptions = {}
): Promise<WalletTransfersResponse | null> {
  const {
    limit = 100,
    cursor,
    direction = 'any',
    with: counterparty,
    mint,
    solMode = 'merged',
    sortOrder = 'desc',
    commitment = 'finalized',
    filters,
  } = options;
  const boundedLimit = Math.min(Math.max(1, limit), 100);
  const cacheKey = `transfers:${address}:${JSON.stringify({ boundedLimit, cursor, direction, counterparty, mint, solMode, sortOrder, commitment, filters })}`;
  const cached = getCached<WalletTransfersResponse | null>(cacheKey);
  if (cached.hit) return cached.value;

  try {
    const config: Record<string, unknown> = {
      limit: boundedLimit,
      direction,
      solMode,
      sortOrder,
      commitment,
    };
    if (cursor) config.paginationToken = cursor;
    if (counterparty) config.with = counterparty;
    if (mint) config.mint = mint;
    if (filters) config.filters = filters;

    const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-transfers-by-address',
        method: 'getTransfersByAddress',
        params: [address, config],
      }),
      maxRetries: 2,
    });

    const json = await response.json();
    if (json.error) {
      throw new Error(`getTransfersByAddress failed: ${json.error.message || JSON.stringify(json.error)}`);
    }

    const rows = (json.result?.data ?? []) as GetTransfersByAddressRow[];
    const nextCursor = json.result?.paginationToken as string | undefined;
    const data: WalletTransfersResponse = {
      data: rows.map(row => normalizeTransferRow(address, row)).filter((row): row is WalletTransfer => row !== null),
      pagination: { hasMore: Boolean(nextCursor), nextCursor },
    };

    setCache(cacheKey, data);
    return data;
  } catch {
    return null;
  }
}

export async function batchGetFirstIncomingSolTransfers(
  addresses: string[],
  options: { fallbackToFundedBy?: boolean; concurrency?: number } = {},
): Promise<Map<string, EnrichedFunderInfo | null>> {
  const { fallbackToFundedBy = true, concurrency = 8 } = options;
  const results = new Map<string, EnrichedFunderInfo | null>();
  const uniqueAddresses = [...new Set(addresses)];
  let index = 0;

  const worker = async () => {
    while (true) {
      const current = index++;
      if (current >= uniqueAddresses.length) break;
      const address = uniqueAddresses[current];

      try {
        const transfers = await getWalletTransfers(address, {
          limit: 1,
          direction: 'in',
          mint: NATIVE_SOL_MINT,
          sortOrder: 'asc',
          solMode: 'merged',
          commitment: 'finalized',
        });
        const first = transfers?.data[0];
        if (first) {
          results.set(address, {
            address: first.counterparty,
            amount: first.amount,
            timestamp: first.timestamp,
            txSignature: first.signature,
            txType: first.type?.toUpperCase() || 'TRANSFER',
            txSource: 'GET_TRANSFERS_BY_ADDRESS',
            viaDex: false,
            viaMixer: false,
          });
          continue;
        }

        results.set(address, fallbackToFundedBy ? await getWalletFundedBy(address) : null);
      } catch {
        results.set(address, fallbackToFundedBy ? await getWalletFundedBy(address) : null);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueAddresses.length) }, () => worker()));

  for (const address of uniqueAddresses) {
    if (!results.has(address)) results.set(address, null);
  }

  return results;
}

// ============================================================================
// INCREMENTAL TOKEN HOLDER FETCHING (getProgramAccountsV2)
// ============================================================================

export interface IncrementalHolder {
  address: string;
  balance: number;
  slot: number;
}

export interface IncrementalHoldersResult {
  holders: IncrementalHolder[];
  lastSlot: number;
}

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Fetch token holders incrementally via getProgramAccountsV2.
 * First call (no sinceSlot) returns full set; subsequent calls return only changed accounts.
 * 1 credit per call vs 10 for the standard method.
 */
export async function getTokenHoldersIncremental(
  mint: string,
  sinceSlot?: number,
): Promise<IncrementalHoldersResult> {
  const holders: IncrementalHolder[] = [];
  let cursor: string | undefined;
  let maxSlot = sinceSlot ?? 0;

  do {
    const rpcParams: Record<string, unknown> = {
      encoding: 'jsonParsed',
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: mint } },
      ],
      maxResults: 1000,
    };

    if (sinceSlot !== undefined) {
      rpcParams.changedSinceSlot = sinceSlot;
    }
    if (cursor) {
      rpcParams.cursor = cursor;
    }

    const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'incremental-holders',
        method: 'getProgramAccountsV2',
        params: [TOKEN_PROGRAM_ID, rpcParams],
      }),
    });

    const data = await response.json();
    const result = data.result;

    if (!result?.accounts?.length) break;

    for (const account of result.accounts) {
      const parsed = account.account?.data?.parsed?.info;
      if (!parsed) continue;

      const balance = Number(parsed.tokenAmount?.amount ?? 0);
      const owner = parsed.owner as string;
      const slot = account.account?.slot ?? result.slot ?? 0;

      holders.push({ address: owner, balance, slot });
      if (slot > maxSlot) maxSlot = slot;
    }

    cursor = result.cursor ?? undefined;
  } while (cursor);

  return { holders, lastSlot: maxSlot };
}

// ============================================================================
// WALLET HISTORY API
// ============================================================================

/**
 * Fetch wallet transfer history via Helius getTransfersByAddress.
 * This returns parsed transfer rows instead of full transaction payloads.
 */
export async function getWalletHistory(
  wallet: string,
  limit: number = 5,
): Promise<WalletTransfer[]> {
  const cacheKey = `wallet-history:${wallet}:${limit}`;
  const cached = getCached<WalletTransfer[]>(cacheKey);
  if (cached.hit) return cached.value;

  const transfers = await getWalletTransfers(wallet, {
    limit: Math.min(Math.max(1, limit), 100),
    direction: 'any',
    sortOrder: 'desc',
    solMode: 'merged',
    commitment: 'finalized',
  });
  const data = transfers?.data ?? [];
  setCache(cacheKey, data);
  return data;
}

// ============================================================================
// RAW RPC: getSignaturesForAddress + getTransaction (jsonParsed)
// Used by snapshot-engine for full token balance reconstruction
// ============================================================================

interface RpcSignatureEntry {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
  confirmationStatus: string;
}

interface RpcTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

export interface ParsedTransactionMeta {
  preTokenBalances: RpcTokenBalance[];
  postTokenBalances: RpcTokenBalance[];
  err: unknown | null;
}

export interface ParsedTransactionResult {
  slot: number;
  blockTime: number | null;
  meta: ParsedTransactionMeta | null;
  transaction: unknown;
}

/**
 * Fetch confirmed signatures for an address with pagination support.
 * Returns oldest-first when using `until` or sorted by the caller.
 */
export async function getRpcSignatures(
  address: string,
  opts: { limit?: number; before?: string; until?: string } = {},
): Promise<RpcSignatureEntry[]> {
  const params: [string, Record<string, unknown>] = [
    address,
    { limit: opts.limit ?? 1000 },
  ];
  if (opts.before) params[1].before = opts.before;
  if (opts.until) params[1].until = opts.until;

  const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'rpc-sigs',
      method: 'getSignaturesForAddress',
      params,
    }),
    maxRetries: 2,
  });

  const data = await response.json();
  return (data.result ?? []) as RpcSignatureEntry[];
}

/**
 * Fetch a single transaction with jsonParsed encoding to access postTokenBalances.
 */
export async function getRpcTransaction(
  signature: string,
): Promise<ParsedTransactionResult | null> {
  const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'rpc-tx',
      method: 'getTransaction',
      params: [
        signature,
        {
          encoding: 'jsonParsed',
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
    maxRetries: 2,
  });

  const data = await response.json();
  return (data.result ?? null) as ParsedTransactionResult | null;
}

/**
 * Batch-fetch multiple transactions via sequential RPC calls with concurrency control.
 * Returns results in the same order as input signatures. Null entries = fetch failure.
 */
export async function getRpcTransactionsBatch(
  signatures: string[],
  concurrency: number = 5,
): Promise<(ParsedTransactionResult | null)[]> {
  const results: (ParsedTransactionResult | null)[] = new Array(signatures.length).fill(null);
  let idx = 0;

  const worker = async () => {
    while (true) {
      const i = idx++;
      if (i >= signatures.length) break;
      try {
        results[i] = await getRpcTransaction(signatures[i]);
      } catch {
        results[i] = null;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, signatures.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ============================================================================
// gTFA: getTransactionsForAddress (Helius-exclusive, 100 full txs per call)
// ============================================================================

export interface GtfaTransaction {
  slot: number;
  blockTime: number | null;
  transaction: unknown;
  meta: {
    err: unknown;
    preTokenBalances: TokenBalanceEntry[];
    postTokenBalances: TokenBalanceEntry[];
    [key: string]: unknown;
  };
}

interface TokenBalanceEntry {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null };
}

/**
 * Fetch full transactions for an address using Helius gTFA.
 * Returns up to 100 full transactions per call with postTokenBalances.
 * Supports chronological sorting and pagination.
 */
export async function getTransactionsForAddressGtfa(
  address: string,
  opts: {
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    paginationToken?: string;
    status?: 'succeeded' | 'failed' | 'any';
    tokenAccounts?: 'none' | 'balanceChanged' | 'all';
  } = {},
): Promise<{ data: GtfaTransaction[]; paginationToken: string | null }> {
  const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'gtfa',
      method: 'getTransactionsForAddress',
      params: [
        address,
        {
          transactionDetails: 'full',
          encoding: 'jsonParsed',
          maxSupportedTransactionVersion: 0,
          sortOrder: opts.sortOrder ?? 'asc',
          limit: Math.min(opts.limit ?? 100, 100),
          ...(opts.paginationToken && { paginationToken: opts.paginationToken }),
          filters: {
            status: opts.status ?? 'succeeded',
            tokenAccounts: opts.tokenAccounts ?? 'none',
          },
        },
      ],
    }),
    maxRetries: 2,
  });

  const json = await response.json();
  const result = json.result ?? { data: [], paginationToken: null };
  return {
    data: (result.data ?? []) as GtfaTransaction[],
    paginationToken: result.paginationToken ?? null,
  };
}

/**
 * Fetch signatures only (lightweight): up to 1000 per page.
 * Returns slot, blockTime, signature, err. No full tx data.
 */
export interface GtfaSignature {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  transactionIndex?: number;
}

export async function getSignaturesForAddressGtfa(
  address: string,
  opts: {
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    paginationToken?: string;
    status?: 'succeeded' | 'failed' | 'any';
    tokenAccounts?: 'none' | 'balanceChanged' | 'all';
  } = {},
): Promise<{ data: GtfaSignature[]; paginationToken: string | null }> {
  const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'gtfa-sigs',
      method: 'getTransactionsForAddress',
      params: [
        address,
        {
          transactionDetails: 'signatures',
          sortOrder: opts.sortOrder ?? 'asc',
          limit: Math.min(opts.limit ?? 1000, 1000),
          ...(opts.paginationToken && { paginationToken: opts.paginationToken }),
          filters: {
            status: opts.status ?? 'succeeded',
            tokenAccounts: opts.tokenAccounts ?? 'none',
          },
        },
      ],
    }),
    maxRetries: 2,
  });

  const json = await response.json();
  const result = json.result ?? { data: [], paginationToken: null };
  return {
    data: (result.data ?? []) as GtfaSignature[],
    paginationToken: result.paginationToken ?? null,
  };
}

// ============================================================================
// TOKEN LARGEST ACCOUNTS: Top 20 holders with balances (1 RPC credit)
// ============================================================================

interface LargestAccountEntry {
  address: string;
  amount: number;
}

/**
 * Get the top 20 token accounts by balance using standard RPC.
 * Returns token account addresses (not owner wallets, resolve via getMultipleAccountsParsed).
 * 1 credit, cached 2 minutes.
 */
export async function getTokenLargestAccounts(mint: string): Promise<LargestAccountEntry[]> {
  const CACHE_TTL_LARGEST = 2 * 60 * 1000;
  const cacheKey = `largest-accounts:${mint}`;
  const cached = getCached<LargestAccountEntry[]>(cacheKey);
  if (cached.hit) return cached.value;

  const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'largest-accounts',
      method: 'getTokenLargestAccounts',
      params: [mint],
    }),
  });

  const data = await response.json();
  const accounts = data.result?.value ?? [];

  const result: LargestAccountEntry[] = accounts.map((acc: { address: string; amount: string; decimals: number; uiAmount: number | null; uiAmountString: string }) => ({
    address: acc.address,
    amount: Number(acc.uiAmountString ?? acc.uiAmount ?? 0),
  }));

  // Manual TTL override since key prefix doesn't match standard patterns
  if (cache.size >= MAX_CACHE_SIZE && !cache.has(cacheKey)) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(cacheKey, { data: result, timestamp: Date.now(), ttl: CACHE_TTL_LARGEST });

  return result;
}

// ============================================================================
// MULTIPLE ACCOUNTS PARSED: Resolve token accounts to owner wallets (1 credit)
// ============================================================================

interface ParsedTokenAccountInfo {
  owner: string;
  mint: string;
  amount: number;
}

/**
 * Resolve token account pubkeys to their owner wallets via getMultipleAccounts.
 * Batches up to 100 addresses per call. Returns owner + balance for each.
 */
export async function getMultipleAccountsParsed(
  addresses: string[]
): Promise<Map<string, ParsedTokenAccountInfo>> {
  const results = new Map<string, ParsedTokenAccountInfo>();
  const BATCH_SIZE = 100;

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);

    const response = await fetchWithRetry(() => getThrottledRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'multi-accounts',
        method: 'getMultipleAccounts',
        params: [batch, { encoding: 'jsonParsed' }],
      }),
    });

    const data = await response.json();
    const accounts = data.result?.value ?? [];

    for (let j = 0; j < accounts.length; j++) {
      const account = accounts[j];
      if (!account?.data?.parsed?.info) continue;

      const info = account.data.parsed.info;
      results.set(batch[j], {
        owner: info.owner as string,
        mint: info.mint as string,
        amount: Number(info.tokenAmount?.uiAmountString ?? info.tokenAmount?.uiAmount ?? 0),
      });
    }
  }

  return results;
}

// ============================================================================
// MINT EARLY TRANSACTIONS: First N txs for a mint address (sniper/bundle detection)
// ============================================================================

/**
 * Fetch early transactions for a mint address using gTFA in ascending order.
 * Used for sniper detection (who bought in first 10 blocks) and bundle detection
 * (who bought in the same slot). Cached 5 minutes.
 */
export async function getMintEarlyTransactions(
  mint: string,
  limit: number = 100
): Promise<GtfaTransaction[]> {
  const CACHE_TTL_MINT_TXS = 5 * 60 * 1000;
  const cacheKey = `mint-early-txs:${mint}:${limit}`;
  const cached = getCached<GtfaTransaction[]>(cacheKey);
  if (cached.hit) return cached.value;

  const result = await getTransactionsForAddressGtfa(mint, {
    sortOrder: 'asc',
    limit: Math.min(limit, 100),
    status: 'succeeded',
  });

  const txs = result.data;

  // Manual TTL override
  if (cache.size >= MAX_CACHE_SIZE && !cache.has(cacheKey)) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(cacheKey, { data: txs, timestamp: Date.now(), ttl: CACHE_TTL_MINT_TXS });

  return txs;
}

// ============================================================================
// DERIVE TOKEN SECURITY: Pure function from DAS asset (zero API calls)
// ============================================================================

/**
 * Derive token security info from a DAS asset object.
 * Same logic as getTokenSecurity but without the API call, use when you already have the asset.
 */
export function deriveTokenSecurity(asset: HeliusAsset): TokenSecurityInfo {
  const riskFactors: string[] = [];
  let riskLevel: TokenSecurityInfo['riskLevel'] = 'low';

  const freezeAuthority = asset.authorities?.find(a =>
    a.scopes.includes('freeze') || a.scopes.includes('full')
  );
  const hasFreezeAuthority = !!freezeAuthority;

  const mintAuthority = asset.authorities?.find(a =>
    a.scopes.includes('mint') || a.scopes.includes('full')
  );
  const hasMintAuthority = !!mintAuthority;

  const isMutable = asset.mutable ?? false;

  if (hasFreezeAuthority && hasMintAuthority) {
    riskLevel = 'critical';
    riskFactors.push('CRITICAL: Both freeze and mint authorities active');
  } else if (hasFreezeAuthority || hasMintAuthority) {
    riskLevel = 'high';
  } else if (isMutable) {
    riskLevel = 'medium';
  }

  if (hasFreezeAuthority) {
    riskFactors.push('Freeze authority enabled - tokens can be frozen');
  }
  if (hasMintAuthority) {
    riskFactors.push('Mint authority enabled - supply can be inflated');
  }
  if (isMutable) {
    riskFactors.push('Metadata is mutable - token identity can change');
  }

  return {
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
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export { sleep };
export type { HeliusTransaction };
