import { RugScore, RugFactor, SupplyConcentration, TokenSecurityInfo } from './types';

// Authority risks — a dev that can mint/freeze can zero your bag at will.
const PTS_MINT_AUTHORITY = 25;
const PTS_FREEZE_AUTHORITY = 20;
const PTS_MUTABLE_METADATA = 5;

// Concentration / insider risks (tiered by supply-held %).
const BUNDLED_TIERS: Tier[] = [{ at: 30, pts: 20 }, { at: 15, pts: 12 }, { at: 5, pts: 6 }];
const CABAL_TIERS: Tier[] = [{ at: 20, pts: 15 }, { at: 10, pts: 9 }, { at: 0.0001, pts: 4 }];
const TOP10_TIERS: Tier[] = [{ at: 50, pts: 15 }, { at: 30, pts: 9 }, { at: 20, pts: 4 }];
const SNIPER_TIERS: Tier[] = [{ at: 15, pts: 10 }, { at: 5, pts: 5 }];
const FRESH_TIERS: Tier[] = [{ at: 60, pts: 8 }, { at: 40, pts: 4 }];
const PTS_GINI_EXTREME = 5;
const GINI_EXTREME_AT = 0.85;

// Traffic-light + confidence cutoffs.
const SCORE_RED = 60;
const SCORE_YELLOW = 30;
const COVERAGE_HIGH = 60;
const COVERAGE_LOW = 30;

interface Tier { at: number; pts: number }

interface RugInput {
  security: TokenSecurityInfo | null;
  supply: SupplyConcentration;
  snipersDetected: number;
  bundleClustersDetected: number;
}

/**
 * Token rug verdict — the 5-second entry signal. Pure function over data the
 * scan already has (supply concentration + token security). Zero API calls.
 *
 * Honesty rule: low holder coverage lowers CONFIDENCE, never the score. On a
 * graduated pump.fun token most supply sits in the AMM pool, so a low observed
 * top10% is invisibility, not safety — discounting the score there would
 * manufacture false green lights.
 */
export function computeRugScore({ security, supply, snipersDetected, bundleClustersDetected }: RugInput): RugScore {
  const factors: RugFactor[] = [];

  if (security?.hasMintAuthority) {
    factors.push({ label: 'Mint authority active — supply can be inflated', severity: 'critical', points: PTS_MINT_AUTHORITY });
  }
  if (security?.hasFreezeAuthority) {
    factors.push({ label: 'Freeze authority active — wallets can be frozen', severity: 'critical', points: PTS_FREEZE_AUTHORITY });
  }

  pushTier(factors, supply.bundledSupplyPct, BUNDLED_TIERS, 'high', pct => `Bundled wallets hold ${pct.toFixed(1)}% of supply`);
  pushTier(factors, supply.cabalSupplyPct, CABAL_TIERS, 'high', pct => `Cabal (shared-funder) wallets hold ${pct.toFixed(1)}%`);
  pushTier(factors, supply.top10Pct, TOP10_TIERS, 'high', pct => `Top 10 holders control ${pct.toFixed(1)}%`);
  pushTier(factors, supply.sniperSupplyPct, SNIPER_TIERS, 'medium', pct => `Snipers hold ${pct.toFixed(1)}% of supply`);
  pushTier(factors, supply.freshWalletPct, FRESH_TIERS, 'medium', pct => `${pct.toFixed(0)}% of holders are fresh wallets`);

  if (security?.isMutable) {
    factors.push({ label: 'Metadata mutable — token identity can change', severity: 'low', points: PTS_MUTABLE_METADATA });
  }
  if (supply.giniCoefficient >= GINI_EXTREME_AT) {
    factors.push({ label: 'Extreme holder concentration (Gini)', severity: 'low', points: PTS_GINI_EXTREME });
  }

  void snipersDetected; void bundleClustersDetected; // counts inform UI elsewhere; score uses supply %

  factors.sort((a, b) => b.points - a.points);
  const score = Math.min(100, factors.reduce((sum, f) => sum + f.points, 0));

  // Both authorities active is an automatic critical regardless of the additive total.
  const bothAuthorities = Boolean(security?.hasMintAuthority && security?.hasFreezeAuthority);
  const level: RugScore['level'] = bothAuthorities || score >= SCORE_RED ? 'red' : score >= SCORE_YELLOW ? 'yellow' : 'green';

  const { confidence, coverageNote } = deriveConfidence(supply);

  return { score, level, confidence, factors, coverageNote };
}

function deriveConfidence(supply: SupplyConcentration): { confidence: RugScore['confidence']; coverageNote?: string } {
  const cov = supply.analyzedSupplyPct;
  const noMintSupply = supply.supplyDenominatorSource === 'sum';

  if (cov >= COVERAGE_HIGH && !noMintSupply) return { confidence: 'high' };

  if (cov < COVERAGE_LOW) {
    return {
      confidence: 'low',
      coverageNote: `Low visibility (${cov.toFixed(0)}% of supply seen) — concentration may understate risk. Treat as a floor.`,
    };
  }
  return {
    confidence: 'medium',
    coverageNote: `Score from top holders only — ${cov.toFixed(0)}% of supply visible.`,
  };
}

function pushTier(
  factors: RugFactor[],
  value: number,
  tiers: Tier[],
  severity: RugFactor['severity'],
  label: (pct: number) => string,
): void {
  for (const tier of tiers) {
    if (value >= tier.at) {
      factors.push({ label: label(value), severity, points: tier.pts });
      return;
    }
  }
}
