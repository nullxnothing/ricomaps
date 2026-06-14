import { getCabalById } from './cabal-fingerprint';
import { getWalletBalances, type WalletBalance } from './helius';
import { pLimit } from './concurrency';
import { isSol, walletRealizedSol } from './wallet-pnl';
import type { CabalIntel, CabalPosition, CabalWalletPnl } from './types';

export type { CabalIntel, CabalPosition, CabalWalletPnl };

/**
 * On-demand "what is this crew doing right now" intel for the atlas drill-down.
 *
 * Two questions, answered Helius-only:
 *  1. WHAT ARE THEY HOLDING: current token positions (USD-valued) aggregated
 *     across the crew's wallets, so you see the bags they're sitting in.
 *  2. ARE THEY WINNING: SOL-flow PnL: realized SOL out minus SOL in per wallet.
 *     Honest proxy, not mark-to-market: positive = they've pulled more SOL than
 *     they put in (taken profit / extracted); negative = still underwater / holding.
 *
 * Bounded cost: only the top N wallets are queried (getWalletBalances is 100
 * credits each), so a drill-down is predictable. Gate this behind $RICO upstream.
 */

const MAX_WALLETS = 8;                 // hard cap on credit spend per drill-down
const TOP_POSITIONS = 8;
// Helius prices illiquid memecoins off thin pools: a single bad quote can read
// as tens of millions. Ignore any one position above this ceiling so the crew's
// "holding now" total stays honest. Real bags on pump.fun crews sit well under it.
const MAX_PLAUSIBLE_POSITION_USD = 5_000_000;

/**
 * Build the live intel snapshot for a cabal. Returns null if the cabal is
 * unknown. Picks the crew's first N wallets (knownWallets is funder-first, the
 * most stable members) and fans out balance + transfer lookups in parallel.
 */
export async function getCabalIntel(id: string): Promise<CabalIntel | null> {
  const cabal = await getCabalById(id);
  if (!cabal) return null;

  const wallets = [...new Set(cabal.knownWallets)].slice(0, MAX_WALLETS);
  const limit = pLimit(4);

  const perWallet = await Promise.all(
    wallets.map((address) =>
      limit(async () => {
        const [balances, realizedSol] = await Promise.all([
          getWalletBalances(address),
          walletRealizedSol(address),
        ]);
        return { address, balances, realizedSol };
      })
    )
  );

  // Aggregate current positions across the crew (skip bare SOL, that's the rail, not a bag).
  const positionMap = new Map<string, CabalPosition>();
  let totalPortfolioUsd = 0;
  let netRealizedSol = 0;
  const walletPnls: CabalWalletPnl[] = [];

  for (const { address, balances, realizedSol } of perWallet) {
    netRealizedSol += realizedSol;
    // Sum from individual balances (skipping bogus quotes) rather than the API's
    // totalUsdValue, which includes the mispriced outliers we want to drop.
    let portfolioUsd = 0;
    for (const bal of balances?.balances ?? []) {
      if (isSol(bal.mint) || bal.usdValue <= 0 || bal.usdValue > MAX_PLAUSIBLE_POSITION_USD) continue;
      portfolioUsd += bal.usdValue;
      mergePosition(positionMap, bal);
    }
    totalPortfolioUsd += portfolioUsd;
    walletPnls.push({ address, realizedSol, portfolioUsd });
  }

  const positions = [...positionMap.values()]
    .sort((a, b) => b.usdValue - a.usdValue)
    .slice(0, TOP_POSITIONS);

  const topWallets = walletPnls
    .sort((a, b) => Math.abs(b.realizedSol) - Math.abs(a.realizedSol))
    .slice(0, 5);

  return {
    id,
    walletsAnalyzed: wallets.length,
    walletsTotal: cabal.knownWallets.length,
    totalPortfolioUsd,
    netRealizedSol,
    positions,
    topWallets,
  };
}

function mergePosition(map: Map<string, CabalPosition>, bal: WalletBalance): void {
  const existing = map.get(bal.mint);
  if (existing) {
    existing.usdValue += bal.usdValue;
    existing.holderCount += 1;
  } else {
    map.set(bal.mint, {
      mint: bal.mint,
      symbol: bal.symbol || bal.mint.slice(0, 4),
      name: bal.name || bal.symbol || 'Unknown',
      usdValue: bal.usdValue,
      holderCount: 1,
      logoUri: bal.logoUri,
    });
  }
}
