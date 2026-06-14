import { getWalletBalances, getWalletTransfers, NATIVE_SOL_MINT, WSOL_MINT } from './helius';
import { pLimit } from './concurrency';
import type { CabalWalletPnl } from './types';

// Same outlier guard as cabal-intel: Helius prices illiquid memecoins off thin
// pools, so one bad quote can read as tens of millions. Drop any single position
// above this when summing a holder's portfolio.
const MAX_PLAUSIBLE_POSITION_USD = 5_000_000;

// Shared SOL-flow PnL primitives, extracted from cabal-intel.ts so both the atlas
// crew drill-down AND per-token holder scans surface the same "are they winning"
// signal. SOL-flow PnL is an honest proxy, not mark-to-market: net SOL pulled out
// minus SOL put in. Positive = extracted profit; negative = still underwater.

export const SOL_MINTS = new Set([NATIVE_SOL_MINT, WSOL_MINT]);

export function isSol(mint: string): boolean {
  return SOL_MINTS.has(mint);
}

/** Net SOL extracted by one wallet over its recent transfer history. */
export async function walletRealizedSol(address: string): Promise<number> {
  const transfers = await getWalletTransfers(address, { limit: 100, direction: 'any', solMode: 'merged', sortOrder: 'desc' });
  if (!transfers) return 0;
  let net = 0;
  for (const t of transfers.data) {
    if (!isSol(t.mint)) continue;
    net += t.direction === 'out' ? t.amount : -t.amount; // out = took SOL, in = spent SOL
  }
  return net;
}

/**
 * Batch SOL-flow PnL for a bounded set of wallets. getWalletTransfers is the only
 * cost here (no balance fetch), so this is cheaper than the full cabal-intel pass.
 * Callers MUST pre-trim to the top holders — never pass the full holder set.
 */
export async function getWalletPnls(addresses: string[], opts: { maxWallets?: number; concurrency?: number } = {}): Promise<Map<string, number>> {
  const { maxWallets = 12, concurrency = 4 } = opts;
  const wallets = [...new Set(addresses)].slice(0, maxWallets);
  const limit = pLimit(concurrency);
  const out = new Map<string, number>();
  await Promise.all(
    wallets.map((address) =>
      limit(async () => {
        try {
          out.set(address, await walletRealizedSol(address));
        } catch {
          // PnL is best-effort; a failed lookup just omits the badge.
        }
      })
    )
  );
  return out;
}

export interface WalletEnrichment {
  realizedSol: number;        // SOL-flow PnL
  solBalance: number;         // native SOL balance (for wealth tier)
  portfolioUsd: number;       // sum of non-SOL holdings (outliers dropped)
}

/**
 * Bounded per-wallet enrichment for the TOP holders on a token scan: realized SOL
 * (1 transfers call) + SOL balance & portfolio (1 balances call). Both Helius calls
 * are cached, so a re-scan is cheap. Callers MUST pre-trim — never the full set.
 */
export async function enrichWallets(addresses: string[], opts: { maxWallets?: number; concurrency?: number } = {}): Promise<Map<string, WalletEnrichment>> {
  const { maxWallets = 12, concurrency = 4 } = opts;
  const wallets = [...new Set(addresses)].slice(0, maxWallets);
  const limit = pLimit(concurrency);
  const out = new Map<string, WalletEnrichment>();
  await Promise.all(
    wallets.map((address) =>
      limit(async () => {
        try {
          const [realizedSol, balances] = await Promise.all([
            walletRealizedSol(address),
            getWalletBalances(address),
          ]);
          let solBalance = 0;
          let portfolioUsd = 0;
          for (const bal of balances?.balances ?? []) {
            if (isSol(bal.mint)) { solBalance += bal.balance; continue; }
            if (bal.usdValue <= 0 || bal.usdValue > MAX_PLAUSIBLE_POSITION_USD) continue;
            portfolioUsd += bal.usdValue;
          }
          out.set(address, { realizedSol, solBalance, portfolioUsd });
        } catch {
          // Enrichment is best-effort; a failure just omits the badges for this wallet.
        }
      })
    )
  );
  return out;
}

// ============================================================================
// Trader-quality / win-rate classification
// ============================================================================

export type TraderQuality = 'winner' | 'neutral' | 'exit-liquidity';

/**
 * Classify a holder from realized SOL flow. Thresholds are deliberately wide so a
 * tiny rounding flow doesn't flip the label — only a meaningful extraction (winner)
 * or meaningful net-in with nothing pulled back (exit liquidity) earns a verdict.
 */
export function traderQuality(realizedSol: number | undefined): TraderQuality {
  if (realizedSol === undefined) return 'neutral';
  if (realizedSol >= 1) return 'winner';
  if (realizedSol <= -2) return 'exit-liquidity';
  return 'neutral';
}

// ============================================================================
// Wealth-tier whale labels (Phanes-parity 🦐🐟🐬🦈🐋)
// ============================================================================

export interface WealthTier {
  emoji: string;
  label: string;
}

// Tiered on a wallet's SOL balance (already on the holder node — no extra fetch).
// Buckets mirror Phanes' familiar shrimp→whale ladder so the read is instant.
const WEALTH_TIERS: { min: number; emoji: string; label: string }[] = [
  { min: 1000, emoji: '🐋', label: 'whale' },
  { min: 250, emoji: '🦈', label: 'shark' },
  { min: 50, emoji: '🐬', label: 'dolphin' },
  { min: 10, emoji: '🐟', label: 'fish' },
  { min: 0, emoji: '🦐', label: 'shrimp' },
];

/** Map a SOL balance to a wealth tier. Returns undefined when balance is unknown. */
export function wealthTier(solBalance: number | undefined): WealthTier | undefined {
  if (solBalance === undefined || solBalance < 0) return undefined;
  const tier = WEALTH_TIERS.find((t) => solBalance >= t.min) ?? WEALTH_TIERS[WEALTH_TIERS.length - 1];
  return { emoji: tier.emoji, label: tier.label };
}

export type { CabalWalletPnl };
