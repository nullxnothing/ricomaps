import { SupplyConcentration } from './types';

const FRESH_WALLET_MAX_AGE_DAYS = 7;
const SECONDS_PER_DAY = 86_400;

interface HolderAmount {
  owner: string;
  amount: number;
  /** Unix seconds the wallet was first funded; used for the fresh-wallet proxy. */
  firstFundedAt?: number;
}

interface ConcentrationInput {
  /** All analyzed holders with their CURRENT token balance. */
  holders: HolderAmount[];
  /** Wallets flagged as bundled (same-slot coordinated buys). */
  bundledWallets: Set<string>;
  /** Wallets flagged as snipers (bought within first N blocks). */
  sniperWallets: Set<string>;
  /** Wallets funded by a detected cabal-funder (shared-funder cluster members). */
  cabalWallets: Set<string>;
  /** Wallets tagged as pool/AMM/treasury — excluded from circulating denominator. */
  poolWallets: Set<string>;
  /** Total mint supply in UI units (token_info.supply / 10^decimals). 0/undefined → fall back to holder sum. */
  mintSupply?: number;
}

/**
 * Aggregate supply-held percentages and holder-distribution health from data the
 * token pipeline already has in memory — zero additional API calls.
 *
 * All percentages are SUPPLY-HELD (current balance / circulating supply), NOT
 * trade volume. This is the methodology traders expect from Trench.bot/Axiom and
 * the one we surface transparently to avoid the volume-vs-supply confusion that
 * makes competing tools disagree on the same token.
 */
export function computeSupplyConcentration(input: ConcentrationInput): SupplyConcentration {
  const { holders, bundledWallets, sniperWallets, cabalWallets, poolWallets, mintSupply } = input;

  const poolSupply = sumWhere(holders, h => poolWallets.has(h.owner));
  const holderSum = holders.reduce((sum, h) => sum + h.amount, 0);

  // Denominator: prefer on-chain mint supply (full picture, not just top-N), minus
  // pool liquidity so AMM/bonding-curve balances don't dilute insider %. Fall back
  // to the analyzed-holder sum on fresh launches where mint supply is unavailable.
  const usableMintSupply = mintSupply && mintSupply > 0 ? mintSupply - poolSupply : 0;
  const denominatorSource: SupplyConcentration['supplyDenominatorSource'] =
    usableMintSupply > 0 ? 'mint' : 'sum';
  const circulatingSupply = usableMintSupply > 0
    ? usableMintSupply
    : Math.max(holderSum - poolSupply, holderSum, 1);

  const pct = (amount: number) => clampPct((amount / circulatingSupply) * 100);

  // Insider set = bundled ∪ sniper. "Still holding" is their current on-chain
  // balance share; wallets that exited (≈0 balance / dropped from holders) simply
  // contribute less here — honest, current-balance-based, matching Trench.bot.
  const insiderWallets = new Set<string>([...bundledWallets, ...sniperWallets]);
  const insiderStillHolding = sumWhere(holders, h => insiderWallets.has(h.owner));

  const realHolders = holders.filter(h => !poolWallets.has(h.owner));
  const sortedReal = [...realHolders].sort((a, b) => b.amount - a.amount);
  const topNSupply = (n: number) =>
    pct(sortedReal.slice(0, n).reduce((sum, h) => sum + h.amount, 0));

  const freshCount = realHolders.filter(isFreshWallet).length;

  // Coverage: what fraction of circulating supply the analyzed holders actually
  // represent. Critical context — on graduated tokens most supply sits in the
  // AMM pool and is NOT in the top-N holder set, so a low top-10% can be
  // misleading without this. We surface it so no % is shown without scope.
  const analyzedSupply = realHolders.reduce((sum, h) => sum + h.amount, 0);
  const analyzedSupplyPct = pct(analyzedSupply);

  return {
    bundledSupplyPct: pct(sumWhere(holders, h => bundledWallets.has(h.owner))),
    sniperSupplyPct: pct(sumWhere(holders, h => sniperWallets.has(h.owner))),
    cabalSupplyPct: pct(sumWhere(holders, h => cabalWallets.has(h.owner))),
    insiderStillHoldingPct: pct(insiderStillHolding),
    top10Pct: topNSupply(10),
    top25Pct: topNSupply(25),
    giniCoefficient: computeGini(realHolders.map(h => h.amount)),
    freshWalletPct: realHolders.length > 0 ? clampPct((freshCount / realHolders.length) * 100) : 0,
    realHolderCount: realHolders.length,
    poolSupplyPct: pct(poolSupply),
    analyzedSupplyPct,
    circulatingSupplyUsed: circulatingSupply,
    supplyDenominatorSource: denominatorSource,
  };
}

/**
 * Gini coefficient of a holding distribution. 0 = perfectly even, 1 = fully
 * concentrated in one wallet. Standard mean-absolute-difference formulation.
 */
export function computeGini(amounts: number[]): number {
  const values = amounts.filter(v => v > 0).sort((a, b) => a - b);
  const n = values.length;
  if (n < 2) return 0;

  const total = values.reduce((sum, v) => sum + v, 0);
  if (total === 0) return 0;

  // Σ (2i - n - 1) * x_i  over 1-indexed sorted values, normalized by n*total.
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    weighted += (2 * (i + 1) - n - 1) * values[i];
  }
  return clamp01(weighted / (n * total));
}

/** Human-readable concentration band from a Gini coefficient. */
export function giniLabel(gini: number): 'Even' | 'Moderate' | 'Concentrated' | 'Extreme' {
  if (gini >= 0.85) return 'Extreme';
  if (gini >= 0.65) return 'Concentrated';
  if (gini >= 0.4) return 'Moderate';
  return 'Even';
}

function isFreshWallet(holder: HolderAmount): boolean {
  if (!holder.firstFundedAt || holder.firstFundedAt <= 0) return false;
  const ageDays = (Date.now() / 1000 - holder.firstFundedAt) / SECONDS_PER_DAY;
  return ageDays >= 0 && ageDays < FRESH_WALLET_MAX_AGE_DAYS;
}

function sumWhere(holders: HolderAmount[], predicate: (h: HolderAmount) => boolean): number {
  return holders.reduce((sum, h) => (predicate(h) ? sum + h.amount : sum), 0);
}

function clampPct(value: number): number {
  return Math.round(clamp01(value / 100) * 1000) / 10; // one decimal, 0–100
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
