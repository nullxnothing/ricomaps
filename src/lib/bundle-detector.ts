import { HeliusTransaction, BundleCluster, BundleTokenAppearance } from './types';
import { generateClusterId } from './db-blacklist';

interface SlotWalletEntry {
  address: string;
  signature: string;
  timestamp: number;
}

interface DetectOptions {
  mintAddress: string;
  tokenName?: string;
  tokenSymbol?: string;
  funderMap?: Map<string, string[]>; // funder → holders it funded
}

/**
 * Detect bundle clusters from holder transaction data.
 * Groups transactions by slot — 2+ wallets in the same slot = bundle.
 * Merges overlapping clusters via union-find.
 * Zero API calls — operates on pre-fetched data.
 */
export function detectBundleClusters(
  holderTxMap: Map<string, HeliusTransaction[]>,
  options: DetectOptions
): BundleCluster[] {
  const { mintAddress, tokenName, tokenSymbol, funderMap } = options;

  // Step 1: For each holder, find their earliest buy/swap tx involving this mint
  const slotGroups = new Map<number, SlotWalletEntry[]>();

  for (const [wallet, txs] of holderTxMap) {
    const buyTx = findEarliestBuyTx(txs, wallet, mintAddress);
    if (!buyTx) continue;

    const entries = slotGroups.get(buyTx.slot) || [];
    entries.push({
      address: wallet,
      signature: buyTx.signature,
      timestamp: buyTx.timestamp,
    });
    slotGroups.set(buyTx.slot, entries);
  }

  // Step 2: Filter to slot groups with 2+ distinct wallets
  const bundleGroups: { slot: number; entries: SlotWalletEntry[] }[] = [];
  for (const [slot, entries] of slotGroups) {
    const uniqueWallets = new Set(entries.map(e => e.address));
    if (uniqueWallets.size >= 2) {
      bundleGroups.push({ slot, entries });
    }
  }

  if (bundleGroups.length === 0) return [];

  // Step 3: Build initial clusters from slot groups
  const rawClusters: { wallets: Set<string>; slots: { slot: number; entries: SlotWalletEntry[] }[] }[] = [];
  for (const group of bundleGroups) {
    rawClusters.push({
      wallets: new Set(group.entries.map(e => e.address)),
      slots: [group],
    });
  }

  // Step 4: Merge overlapping clusters (union-find style)
  const merged = mergeOverlappingClusters(rawClusters);

  // Step 5: Build final BundleCluster objects with confidence scoring
  const clusters: BundleCluster[] = [];

  for (const cluster of merged) {
    const wallets = Array.from(cluster.wallets).sort();
    const allEntries = cluster.slots.flatMap(s => s.entries);
    const timestamps = allEntries.map(e => e.timestamp).filter(Boolean);
    const signatures = [...new Set(allEntries.map(e => e.signature))];

    // Check for shared funder
    let sharedFunder: string | undefined;
    if (funderMap) {
      for (const [funder, fundedHolders] of funderMap) {
        const overlap = wallets.filter(w => fundedHolders.includes(w));
        if (overlap.length >= 2) {
          sharedFunder = funder;
          break;
        }
      }
    }

    // Confidence scoring
    let confidence = 50; // Base: same-slot is a strong signal
    confidence += Math.min(30, (wallets.length - 2) * 10); // +10 per extra wallet
    if (sharedFunder) confidence += 20; // Shared funder confirms coordination

    const tokenAppearance: BundleTokenAppearance = {
      mint: mintAddress,
      tokenName,
      tokenSymbol,
      slot: cluster.slots[0].slot,
      timestamp: Math.min(...timestamps.filter(t => t > 0), Date.now() / 1000),
      walletCount: wallets.length,
      transactionSignatures: signatures,
    };

    clusters.push({
      id: generateClusterId(wallets),
      wallets,
      tokens: [tokenAppearance],
      totalAppearances: 1,
      lastSeenTimestamp: Math.max(...timestamps.filter(t => t > 0), 0),
      firstSeenTimestamp: Math.min(...timestamps.filter(t => t > 0), Date.now() / 1000),
      confidence: Math.min(100, confidence),
      sharedFunder,
      metadata: {
        avgClusterSize: wallets.length,
        maxSameSlotCount: Math.max(...cluster.slots.map(s => s.entries.length)),
      },
    });
  }

  return clusters;
}

/**
 * Find the earliest buy/swap transaction for a wallet involving a specific token.
 * Checks tokenTransfers for the target mint, or swap events involving it.
 */
function findEarliestBuyTx(
  txs: HeliusTransaction[],
  wallet: string,
  mintAddress: string
): HeliusTransaction | null {
  // Sort ascending by timestamp/slot
  const sorted = [...txs].sort((a, b) => (a.slot || 0) - (b.slot || 0));

  for (const tx of sorted) {
    // Check token transfers — wallet received the target token
    if (tx.tokenTransfers?.some(tt =>
      tt.mint === mintAddress && tt.toUserAccount === wallet && tt.tokenAmount > 0
    )) {
      return tx;
    }

    // Check swap events — token appears in outputs
    if (tx.events?.swap) {
      const swap = tx.events.swap;
      const hasTokenOutput = swap.tokenOutputs?.some(o => o.mint === mintAddress);
      if (hasTokenOutput) return tx;
    }

    // Check account data for token balance increase on this mint
    if (tx.accountData?.some(ad =>
      ad.tokenBalanceChanges?.some(tbc =>
        tbc.mint === mintAddress &&
        tbc.userAccount === wallet &&
        Number(tbc.rawTokenAmount?.tokenAmount) > 0
      )
    )) {
      return tx;
    }
  }

  return null;
}

/**
 * Merge clusters that share wallets using iterative union-find.
 */
function mergeOverlappingClusters(
  clusters: { wallets: Set<string>; slots: { slot: number; entries: SlotWalletEntry[] }[] }[]
): { wallets: Set<string>; slots: { slot: number; entries: SlotWalletEntry[] }[] }[] {
  if (clusters.length <= 1) return clusters;

  let changed = true;
  let current = [...clusters];

  while (changed) {
    changed = false;
    const merged: typeof current = [];
    const consumed = new Set<number>();

    for (let i = 0; i < current.length; i++) {
      if (consumed.has(i)) continue;

      let combined = {
        wallets: new Set(current[i].wallets),
        slots: [...current[i].slots],
      };

      for (let j = i + 1; j < current.length; j++) {
        if (consumed.has(j)) continue;

        // Check overlap
        const hasOverlap = [...current[j].wallets].some(w => combined.wallets.has(w));
        if (hasOverlap) {
          for (const w of current[j].wallets) combined.wallets.add(w);
          combined.slots.push(...current[j].slots);
          consumed.add(j);
          changed = true;
        }
      }

      merged.push(combined);
    }

    current = merged;
  }

  return current;
}
