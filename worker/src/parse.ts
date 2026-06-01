import bs58 from 'bs58';
import type { SubscribeUpdate } from 'helius-laserstream';

/**
 * One owner's token balance change for a watched mint, derived from a single
 * transaction's pre/postTokenBalances. `delta` can be negative (a sell).
 * `newBalance === 0` means the owner's position closed (client removes the node).
 */
export interface HolderDelta {
  mint: string;
  owner: string;
  newBalance: number;
  delta: number;
  slot: number;
  signature: string;
}

interface TokenBalance {
  accountIndex?: number | null;
  mint?: string | null;
  owner?: string | null;
  uiTokenAmount?: { amount?: string | null; decimals?: number | null; uiAmount?: number | null } | null;
}

const KEY = (accountIndex: number, mint: string) => `${accountIndex}:${mint}`;

function uiAmount(bal: TokenBalance | undefined): number {
  const ui = bal?.uiTokenAmount;
  if (!ui) return 0;
  if (typeof ui.uiAmount === 'number' && Number.isFinite(ui.uiAmount)) return ui.uiAmount;
  const raw = Number(ui.amount ?? 0);
  const decimals = ui.decimals ?? 0;
  if (!Number.isFinite(raw)) return 0;
  return raw / Math.pow(10, decimals);
}

function toSlot(slot: unknown): number {
  // LaserStream emits u64 slots as number | Long. Long has toNumber(); plain numbers pass through.
  if (typeof slot === 'number') return slot;
  if (slot && typeof (slot as { toNumber?: () => number }).toNumber === 'function') {
    return (slot as { toNumber: () => number }).toNumber();
  }
  return Number(slot ?? 0) || 0;
}

/**
 * Derive per-owner balance deltas for `watchedMints` from a LaserStream transaction update.
 * Mirrors the pre/postTokenBalances diff in `convertGtfaToHeliusTransaction` (src/lib/helius.ts),
 * but emits sells (negative deltas) and closes (newBalance 0) too, scoped to watched mints.
 * Returns [] for non-transaction updates (ping/slot/account/etc).
 */
export function parseHolderDeltas(update: SubscribeUpdate, watchedMints: Set<string>): HolderDelta[] {
  const txUpdate = update.transaction;
  const info = txUpdate?.transaction;
  const meta = info?.meta;
  if (!txUpdate || !info || !meta) return [];

  const pre = (meta.preTokenBalances ?? []) as TokenBalance[];
  const post = (meta.postTokenBalances ?? []) as TokenBalance[];
  if (pre.length === 0 && post.length === 0) return [];

  const slot = toSlot(txUpdate.slot);
  const signature = info.signature ? bs58.encode(info.signature as Uint8Array) : '';

  const preByKey = new Map<string, TokenBalance>();
  for (const b of pre) {
    if (b.accountIndex == null || !b.mint) continue;
    preByKey.set(KEY(b.accountIndex, b.mint), b);
  }

  const deltas: HolderDelta[] = [];
  const seen = new Set<string>();

  // Increases / changes: walk post balances.
  for (const b of post) {
    if (b.accountIndex == null || !b.mint || !b.owner) continue;
    if (!watchedMints.has(b.mint)) continue;

    const key = KEY(b.accountIndex, b.mint);
    seen.add(key);
    const preBal = preByKey.get(key);
    const newBalance = uiAmount(b);
    const delta = newBalance - uiAmount(preBal);
    if (delta === 0) continue;

    deltas.push({ mint: b.mint, owner: b.owner, newBalance, delta, slot, signature });
  }

  // Closes: a token account present in pre but absent in post → balance went to 0.
  for (const b of pre) {
    if (b.accountIndex == null || !b.mint || !b.owner) continue;
    if (!watchedMints.has(b.mint)) continue;
    const key = KEY(b.accountIndex, b.mint);
    if (seen.has(key)) continue;

    const prevBalance = uiAmount(b);
    if (prevBalance === 0) continue;
    deltas.push({ mint: b.mint, owner: b.owner, newBalance: 0, delta: -prevBalance, slot, signature });
  }

  return deltas;
}
