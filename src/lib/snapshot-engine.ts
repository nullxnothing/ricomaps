import {
  getTransactionsForAddressGtfa,
  getSignaturesForAddressGtfa,
  GtfaTransaction,
  GtfaSignature,
} from './helius';
import { pLimit } from './concurrency';

// ============================================================================
// TYPES
// ============================================================================

export interface HolderEntry {
  address: string;
  balance: number;
  pctSupply: number;
}

export interface Snapshot {
  slot: number;
  blockTime: number;
  holders: HolderEntry[];
  totalHolders: number;
  topHolderPct: number;
  top10Pct: number;
}

export interface TokenHistory {
  mint: string;
  snapshots: Snapshot[];
  totalTransactions: number;
  createdAt: number;
  lastUpdated: number;
}

interface BackfillState {
  // Signature collection phase
  allSigs: GtfaSignature[];
  sigPaginationToken?: string;
  sigsComplete: boolean;

  // Replay phase
  snapshots: Snapshot[];
  holderMap: Map<string, number>;
  replayPaginationToken?: string;
  replayTxCount: number;
  snapshotEvery: number;
  txSinceSnapshot: number;

  // Status
  isComplete: boolean;
  progress: number;
  totalTransactions: number;
  createdAt: number;
  isRunning: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TARGET_SNAPSHOTS = 50;
const SIGS_PER_PAGE = 1000;
const MAX_SIG_PAGES_PER_CHUNK = 15; // Process 15 sig pages per request (~15k sigs)
const MAX_TX_PAGES_PER_CHUNK = 20; // Process 20 full-tx pages per request (~2000 txs)
const MIN_OWNER_SLOT = 111_491_819;

// ============================================================================
// IN-MEMORY STORE (persists across requests on same Vercel isolate)
// ============================================================================

const store = new Map<string, BackfillState>();
const backfillLimit = pLimit(3);

// ============================================================================
// CHUNKED ENGINE: works within Vercel's 30s timeout
// ============================================================================

/**
 * Process one chunk of the backfill. Call repeatedly until complete.
 * Each call processes up to ~20 seconds of work, then returns progress.
 * State persists in memory across calls on the same isolate.
 */
export async function backfillTokenHistory(
  mint: string,
  onProgress?: (pct: number) => void,
): Promise<TokenHistory> {
  let state = store.get(mint);

  if (state?.isComplete) return buildTokenHistory(mint, state);
  if (state?.isRunning) return buildTokenHistory(mint, state);

  if (!state) {
    state = {
      allSigs: [],
      sigsComplete: false,
      snapshots: [],
      holderMap: new Map(),
      replayTxCount: 0,
      snapshotEvery: 100,
      txSinceSnapshot: 0,
      isComplete: false,
      progress: 0,
      totalTransactions: 0,
      createdAt: 0,
      isRunning: false,
    };
    store.set(mint, state);
  }

  state.isRunning = true;

  try {
    await backfillLimit(() => processChunk(mint, state!, onProgress));
  } finally {
    state.isRunning = false;
  }

  return buildTokenHistory(mint, state);
}

async function processChunk(
  mint: string,
  state: BackfillState,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const startTime = Date.now();
  const TIME_BUDGET_MS = 20_000; // Leave 10s buffer for Vercel's 30s limit

  // ── Phase 1: Collect signatures (chunked) ──
  if (!state.sigsComplete) {
    let pagesThisChunk = 0;

    while (pagesThisChunk < MAX_SIG_PAGES_PER_CHUNK && Date.now() - startTime < TIME_BUDGET_MS) {
      const result = await getSignaturesForAddressGtfa(mint, {
        sortOrder: 'asc',
        limit: SIGS_PER_PAGE,
        paginationToken: state.sigPaginationToken,
        status: 'succeeded',
        tokenAccounts: 'balanceChanged',
      });

      if (!result.data || result.data.length === 0) {
        state.sigsComplete = true;
        break;
      }

      for (const sig of result.data) {
        if (sig.err === null) state.allSigs.push(sig);
      }

      state.sigPaginationToken = result.paginationToken ?? undefined;
      pagesThisChunk++;

      if (!result.paginationToken || result.data.length < SIGS_PER_PAGE) {
        state.sigsComplete = true;
        break;
      }
    }

    if (state.sigsComplete && state.allSigs.length > 0) {
      state.totalTransactions = state.allSigs.length;
      state.createdAt = state.allSigs[0].blockTime ?? 0;
      state.snapshotEvery = Math.max(50, Math.ceil(state.allSigs.length / TARGET_SNAPSHOTS));
    }

    // Progress: sigs phase = 0-30%
    if (!state.sigsComplete) {
      // Don't know total yet: estimate based on pages collected
      const totalSigPages = state.allSigs.length / SIGS_PER_PAGE;
      state.progress = Math.min(25, totalSigPages * 3);
    } else {
      state.progress = 30;
    }
    onProgress?.(state.progress);

    if (!state.sigsComplete || state.allSigs.length === 0) {
      if (state.allSigs.length === 0 && state.sigsComplete) {
        state.isComplete = true;
        state.progress = 100;
      }
      return;
    }
  }

  // ── Phase 2: Replay transactions (chunked) ──
  let pagesThisChunk = 0;

  while (pagesThisChunk < MAX_TX_PAGES_PER_CHUNK && Date.now() - startTime < TIME_BUDGET_MS) {
    const result = await getTransactionsForAddressGtfa(mint, {
      sortOrder: 'asc',
      limit: 100,
      paginationToken: state.replayPaginationToken,
      status: 'succeeded',
      tokenAccounts: 'balanceChanged',
    });

    const txs = result.data;
    if (!txs || txs.length === 0) {
      // Done: take final snapshot
      if (state.txSinceSnapshot > 0 && state.allSigs.length > 0) {
        const lastSig = state.allSigs[state.allSigs.length - 1];
        takeSnapshot(state, lastSig.slot, lastSig.blockTime ?? 0);
      }
      state.isComplete = true;
      state.progress = 100;
      onProgress?.(100);
      return;
    }

    for (const tx of txs) {
      if (!tx.meta || tx.meta.err !== null) continue;

      processTransaction(tx, mint, state);
      state.replayTxCount++;
      state.txSinceSnapshot++;

      if (state.txSinceSnapshot >= state.snapshotEvery) {
        takeSnapshot(state, tx.slot, tx.blockTime ?? 0);
        state.txSinceSnapshot = 0;
      }
    }

    state.replayPaginationToken = result.paginationToken ?? undefined;
    pagesThisChunk++;

    // Progress: replay phase = 30-95%
    const replayPct = state.totalTransactions > 0
      ? (state.replayTxCount / state.totalTransactions) * 65
      : 0;
    state.progress = Math.min(95, 30 + replayPct);
    onProgress?.(state.progress);

    if (!result.paginationToken || txs.length < 100) {
      if (state.txSinceSnapshot > 0 && state.allSigs.length > 0) {
        const lastSig = state.allSigs[state.allSigs.length - 1];
        takeSnapshot(state, lastSig.slot, lastSig.blockTime ?? 0);
      }
      state.isComplete = true;
      state.progress = 100;
      onProgress?.(100);
      return;
    }
  }
}

// ============================================================================
// TRANSACTION PROCESSING
// ============================================================================

function processTransaction(
  tx: GtfaTransaction,
  targetMint: string,
  state: BackfillState,
): void {
  const meta = tx.meta;
  if (!meta) return;

  const postBalances = meta.postTokenBalances ?? [];
  const seenOwners = new Set<string>();

  for (const entry of postBalances) {
    if (entry.mint !== targetMint) continue;
    if (!entry.owner) {
      if (tx.slot < MIN_OWNER_SLOT) continue;
      continue;
    }

    seenOwners.add(entry.owner);
    const rawAmount = Number(entry.uiTokenAmount.amount);
    const balance = entry.uiTokenAmount.uiAmount ?? rawAmount / Math.pow(10, entry.uiTokenAmount.decimals);

    if (!Number.isFinite(balance) || balance === 0) {
      state.holderMap.delete(entry.owner);
    } else {
      state.holderMap.set(entry.owner, balance);
    }
  }

  const preBalances = meta.preTokenBalances ?? [];
  for (const entry of preBalances) {
    if (entry.mint !== targetMint) continue;
    if (!entry.owner) continue;
    if (seenOwners.has(entry.owner)) continue;
    state.holderMap.delete(entry.owner);
  }
}

function takeSnapshot(state: BackfillState, slot: number, blockTime: number): void {
  if (state.snapshots.length > 0 && state.snapshots[state.snapshots.length - 1].slot === slot) return;

  const entries: HolderEntry[] = [];
  let totalSupply = 0;

  for (const [address, balance] of state.holderMap) {
    totalSupply += balance;
    entries.push({ address, balance, pctSupply: 0 });
  }

  if (totalSupply > 0) {
    for (const entry of entries) {
      entry.pctSupply = (entry.balance / totalSupply) * 100;
    }
  }

  entries.sort((a, b) => b.balance - a.balance);

  state.snapshots.push({
    slot,
    blockTime,
    holders: entries,
    totalHolders: entries.length,
    topHolderPct: entries.length > 0 ? entries[0].pctSupply : 0,
    top10Pct: entries.slice(0, 10).reduce((sum, e) => sum + e.pctSupply, 0),
  });
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

export function getSnapshot(mint: string, timestamp: number): Snapshot | null {
  const state = store.get(mint);
  if (!state || state.snapshots.length === 0) return null;

  let nearest = state.snapshots[0];
  let minDiff = Math.abs(nearest.blockTime - timestamp);

  for (let i = 1; i < state.snapshots.length; i++) {
    const diff = Math.abs(state.snapshots[i].blockTime - timestamp);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = state.snapshots[i];
    }
  }

  return nearest;
}

export function getTimeline(mint: string): {
  timestamps: number[];
  topHolderPcts: number[];
  top10Pcts: number[];
  holderCounts: number[];
} | null {
  const state = store.get(mint);
  if (!state || state.snapshots.length === 0) return null;

  return {
    timestamps: state.snapshots.map(s => s.blockTime),
    topHolderPcts: state.snapshots.map(s => s.topHolderPct),
    top10Pcts: state.snapshots.map(s => s.top10Pct),
    holderCounts: state.snapshots.map(s => s.totalHolders),
  };
}

export function isBackfillComplete(mint: string): boolean {
  return store.get(mint)?.isComplete ?? false;
}

export function getBackfillProgress(mint: string): number {
  return store.get(mint)?.progress ?? 0;
}

export function isBackfillRunning(mint: string): boolean {
  return store.get(mint)?.isRunning ?? false;
}

export function getSnapshotSummaries(mint: string): {
  slot: number;
  blockTime: number;
  totalHolders: number;
  topHolderPct: number;
  top10Pct: number;
}[] | null {
  const state = store.get(mint);
  if (!state || state.snapshots.length === 0) return null;

  return state.snapshots.map(s => ({
    slot: s.slot,
    blockTime: s.blockTime,
    totalHolders: s.totalHolders,
    topHolderPct: s.topHolderPct,
    top10Pct: s.top10Pct,
  }));
}

function buildTokenHistory(mint: string, state: BackfillState): TokenHistory {
  return {
    mint,
    snapshots: state.snapshots,
    totalTransactions: state.totalTransactions,
    createdAt: state.createdAt,
    lastUpdated: state.snapshots.length > 0
      ? state.snapshots[state.snapshots.length - 1].blockTime
      : 0,
  };
}
