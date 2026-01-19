import {
  HeliusTransaction,
  TokenHolder,
  HeliusAsset,
  HeliusTransactionType,
  TokenSecurityInfo,
  EnrichedFunderInfo,
  WalletProfile
} from './types';

// Multi-key rotation for load balancing across free accounts
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

function getHeliusRpcUrl(apiKey?: string): string {
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey || getNextApiKey()}`;
}

function getHeliusApiUrl(endpoint: string, apiKey?: string): string {
  return `https://api.helius.xyz/v0${endpoint}?api-key=${apiKey || getNextApiKey()}`;
}

// Legacy constants for backwards compatibility
const HELIUS_API_KEY = API_KEYS[0] || process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const HELIUS_API_URL = `https://api.helius.xyz/v0`;

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
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour - aggressive caching to reduce API calls

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============================================================================
// RETRY LOGIC WITH EXPONENTIAL BACKOFF + GLOBAL RATE LIMITING
// ============================================================================

// Global request queue to prevent overwhelming the API
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 300; // Minimum 300ms between requests (more conservative)

async function throttleRequest(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await sleep(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
  }
  lastRequestTime = Date.now();
}

interface FetchOptions extends RequestInit {
  maxRetries?: number;
  baseDelay?: number;
}

async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const { maxRetries = 5, baseDelay = 2000, ...fetchOptions } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Throttle requests globally
      await throttleRequest();

      const response = await fetch(url, fetchOptions);

      // Handle rate limiting with backoff
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : baseDelay * Math.pow(2, attempt);
        console.warn(`Rate limited (attempt ${attempt + 1}/${maxRetries}). Waiting ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      // Handle server errors with retry
      if (response.status >= 500) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`Server error ${response.status} (attempt ${attempt + 1}/${maxRetries}). Waiting ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      // Handle other errors
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Helius API error ${response.status}: ${errorBody}`);
      }

      return response;
    } catch (error) {
      lastError = error as Error;
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

  const response = await fetchWithRetry(getHeliusApiUrl('/transactions'), {
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
    tokenAccounts = 'balanceChanged', // Include ATA transactions by default
    skipCache = false
  } = options;

  const cacheKey = `txs:${address}:${limit}:${tokenAccounts}:${sortOrder}`;

  // Check cache unless skipCache is true (for real-time streaming)
  if (!skipCache) {
    const cached = getCached<HeliusTransaction[]>(cacheKey);
    if (cached) return cached;
  }

  // Step 1: Get signatures using new RPC method (supports tokenAccounts filter)
  const rpcResponse = await fetchWithRetry(getHeliusRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'get-signatures',
      method: 'getTransactionsForAddress',
      params: [
        address,
        {
          limit: Math.min(limit, 1000), // signatures mode allows up to 1000
          sortOrder,
          transactionDetails: 'signatures',
          filters: {
            tokenAccounts,
            status: 'succeeded'
          }
        }
      ]
    })
  });

  const rpcResult = await rpcResponse.json();

  if (rpcResult.error) {
    console.error('getTransactionsForAddress RPC error:', rpcResult.error);
    throw new Error(rpcResult.error.message || 'Failed to fetch transaction signatures');
  }

  const signaturesData: SignatureData[] = rpcResult.result?.data || [];

  if (signaturesData.length === 0) {
    setCache(cacheKey, []);
    return [];
  }

  // Step 2: Parse signatures to get enriched transaction data (batch in groups of 100)
  const allTransactions: HeliusTransaction[] = [];
  const batchSize = 100;

  for (let i = 0; i < signaturesData.length; i += batchSize) {
    const batch = signaturesData.slice(i, i + batchSize);
    const signatures = batch.map(s => s.signature);

    const parsed = await parseTransactions(signatures);
    allTransactions.push(...parsed);

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < signaturesData.length) {
      await sleep(100);
    }
  }

  // Sort by timestamp
  if (sortOrder === 'asc') {
    allTransactions.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  } else {
    allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  setCache(cacheKey, allTransactions);
  return allTransactions;
}

/**
 * Get complete transaction history with pagination
 * Use this when you need the oldest transactions (genesis funding)
 * Uses hybrid approach: RPC for signatures (with ATA support) + Parse API for enriched data
 */
export async function getAllTransactionsForAddress(
  address: string,
  options: {
    maxPages?: number;
    tokenAccounts?: 'none' | 'balanceChanged' | 'all';
  } = {}
): Promise<HeliusTransaction[]> {
  const {
    maxPages = 20,
    tokenAccounts = 'balanceChanged'
  } = options;

  const allSignatures: string[] = [];
  let paginationToken: string | undefined;
  let page = 0;

  // Step 1: Collect all signatures with pagination
  while (page < maxPages) {
    const rpcResponse = await fetchWithRetry(getHeliusRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-all-signatures',
        method: 'getTransactionsForAddress',
        params: [
          address,
          {
            limit: 1000, // Max for signatures mode
            sortOrder: 'asc', // Get oldest first
            transactionDetails: 'signatures',
            filters: {
              tokenAccounts,
              status: 'succeeded'
            },
            ...(paginationToken && { paginationToken })
          }
        ]
      })
    });

    const rpcResult = await rpcResponse.json();

    if (rpcResult.error) {
      console.error('getAllTransactionsForAddress RPC error:', rpcResult.error);
      break;
    }

    const signaturesData: SignatureData[] = rpcResult.result?.data || [];

    if (signaturesData.length === 0) break;

    allSignatures.push(...signaturesData.map(s => s.signature));
    paginationToken = rpcResult.result?.paginationToken;
    page++;

    // No more pages if no pagination token returned
    if (!paginationToken) break;

    // Small delay to avoid rate limiting
    if (page < maxPages) {
      await sleep(100);
    }
  }

  if (allSignatures.length === 0) return [];

  // Step 2: Parse all signatures in batches
  const allTransactions: HeliusTransaction[] = [];
  const batchSize = 100;

  for (let i = 0; i < allSignatures.length; i += batchSize) {
    const batch = allSignatures.slice(i, i + batchSize);
    const parsed = await parseTransactions(batch);
    allTransactions.push(...parsed);

    // Small delay between batches
    if (i + batchSize < allSignatures.length) {
      await sleep(100);
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
    const response = await fetchWithRetry(getHeliusRpcUrl(), {
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
      await sleep(100);
    }
  }

  setCache(cacheKey, holders);
  return holders;
}

// ============================================================================
// ENRICHED FUNDER DETECTION
// ============================================================================

/**
 * Get first funders with enriched forensic data
 * Optimized: only fetches enough transactions to find the first few funders
 */
export async function getFirstFunders(
  address: string,
  count: number = 3
): Promise<EnrichedFunderInfo[]> {
  // Optimized: Only fetch 20 transactions - enough to find first funders
  // Most wallets are funded in their first few transactions
  const transactions = await getTransactionsForAddress(address, {
    limit: 20,
    sortOrder: 'asc'
  });

  const funders: EnrichedFunderInfo[] = [];
  const seenFunders = new Set<string>();

  for (const tx of transactions) {
    if (funders.length >= count) break;

    // Check native transfers
    if (tx.nativeTransfers) {
      for (const transfer of tx.nativeTransfers) {
        if (transfer.toUserAccount === address && !seenFunders.has(transfer.fromUserAccount)) {
          seenFunders.add(transfer.fromUserAccount);

          const viaDex = DEX_SOURCES.has(tx.source?.toUpperCase() || '');
          const viaMixer = MIXER_SOURCES.has(tx.source?.toUpperCase() || '');

          funders.push({
            address: transfer.fromUserAccount,
            amount: transfer.amount / 1e9,
            timestamp: tx.timestamp,
            txSignature: tx.signature,
            txType: tx.type || 'UNKNOWN',
            txSource: tx.source || 'UNKNOWN',
            description: tx.description,
            viaDex,
            viaMixer,
          });
        }
      }
    }

    // Fallback to accountData if no native transfers
    if (funders.length === 0 && tx.accountData) {
      for (const account of tx.accountData) {
        if (account.account === address && account.nativeBalanceChange > 0) {
          const sender = tx.accountData.find(
            a => a.nativeBalanceChange < 0 && a.account !== address
          );
          if (sender && !seenFunders.has(sender.account)) {
            seenFunders.add(sender.account);

            const viaDex = DEX_SOURCES.has(tx.source?.toUpperCase() || '');
            const viaMixer = MIXER_SOURCES.has(tx.source?.toUpperCase() || '');

            funders.push({
              address: sender.account,
              amount: account.nativeBalanceChange / 1e9,
              timestamp: tx.timestamp,
              txSignature: tx.signature,
              txType: tx.type || 'UNKNOWN',
              txSource: tx.source || 'UNKNOWN',
              description: tx.description,
              viaDex,
              viaMixer,
            });
          }
        }
      }
    }
  }

  return funders.slice(0, count);
}

/**
 * Legacy function for backward compatibility
 */
export async function getFirstFundersSimple(
  address: string,
  count: number = 5
): Promise<{ address: string; amount: number; timestamp: number; txSignature: string }[]> {
  const enriched = await getFirstFunders(address, count);
  return enriched.map(f => ({
    address: f.address,
    amount: f.amount,
    timestamp: f.timestamp,
    txSignature: f.txSignature,
  }));
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
    const response = await fetchWithRetry(getHeliusRpcUrl(), {
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

  const response = await fetchWithRetry(getHeliusRpcUrl(), {
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
      const response = await fetchWithRetry(getHeliusRpcUrl(), {
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
      await sleep(100);
    }
  }

  return results;
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
