import type { BotActivityScore, RugFactor, RugScore, TokenMetadata } from './types';

interface ParsedMintTx {
  slot: number;
  meta?: {
    postTokenBalances?: {
      mint: string;
      owner?: string;
      uiTokenAmount?: { uiAmount?: number | null };
    }[];
  } | null;
}

interface BotActivityInput {
  mintAddress: string;
  mintEarlyTxs: ParsedMintTx[];
  tokenMetadata: TokenMetadata | null;
  top10Pct: number;
  /**
   * Bundles confirmed by bundle-detector.ts (shared funder, or a tight cluster
   * that isn't launch noise). This is the ONLY same-slot coordination signal we
   * trust: raw same-slot co-occurrence is just Solana batching independent txns
   * into one ~400ms slot, not evidence of botting.
   */
  bundleClustersDetected: number;
}

interface Signal {
  factor: RugFactor;
  strong: boolean;
}

const SCORE_RED = 60;
const SCORE_YELLOW = 30;

export function computeBotActivityScore({
  mintAddress,
  mintEarlyTxs,
  tokenMetadata,
  top10Pct,
  bundleClustersDetected,
}: BotActivityInput): BotActivityScore {
  const factors: RugFactor[] = [];
  const signals: Signal[] = [];
  // Slot groups are kept for METRICS/context only — they no longer drive scoring.
  // Same-slot co-occurrence isn't coordination (a slot batches independent txns).
  const slotGroups = getEarlySlotGroups(mintAddress, mintEarlyTxs);
  const sameSlotGroupCount = slotGroups.filter(group => group.wallets >= 2).length;
  const maxSameSlotBuyers = Math.max(0, ...slotGroups.map(group => group.wallets));
  const earlyUniqueBuyers = new Set(slotGroups.flatMap(group => group.owners)).size;

  const txs5m = sumTxns(tokenMetadata?.txns5m);
  const txs1h = sumTxns(tokenMetadata?.txns1h);
  const buySellRatio5m = ratio(tokenMetadata?.txns5m?.buys, tokenMetadata?.txns5m?.sells);
  const buySellRatio1h = ratio(tokenMetadata?.txns1h?.buys, tokenMetadata?.txns1h?.sells);
  const volumeToLiquidity1h = tokenMetadata?.volume1h != null && tokenMetadata?.liquidity
    ? tokenMetadata.volume1h / tokenMetadata.liquidity
    : undefined;

  // Coordination signal: ONLY confirmed bundles (shared funder / tight non-noise
  // cluster) from bundle-detector.ts. Raw same-slot co-occurrence scores zero.
  if (bundleClustersDetected >= 3) {
    signals.push({
      factor: { label: `${bundleClustersDetected} coordinated bundle clusters`, severity: 'critical', points: 28 },
      strong: true,
    });
  } else if (bundleClustersDetected >= 1) {
    signals.push({
      factor: { label: `${bundleClustersDetected} coordinated bundle cluster${bundleClustersDetected === 1 ? '' : 's'}`, severity: 'high', points: 18 },
      strong: true,
    });
  }
  if ((txs5m ?? 0) >= 400 || (txs1h ?? 0) >= 4_000) {
    signals.push({
      factor: { label: `Extreme trade velocity: ${formatCount(txs5m)} tx/5m, ${formatCount(txs1h)} tx/1h`, severity: 'high', points: 22 },
      strong: true,
    });
  }
  if (((buySellRatio5m ?? 0) >= 4 && (txs5m ?? 0) >= 100) || ((buySellRatio1h ?? 0) >= 4 && (txs1h ?? 0) >= 1_000)) {
    signals.push({
      factor: { label: `Buy/sell imbalance: ${formatRatio(buySellRatio5m)} 5m, ${formatRatio(buySellRatio1h)} 1h`, severity: 'medium', points: 12 },
      strong: false,
    });
  }
  if ((volumeToLiquidity1h ?? 0) >= 5) {
    signals.push({
      factor: { label: `High churn: 1h volume is ${volumeToLiquidity1h!.toFixed(1)}x liquidity`, severity: 'medium', points: 16 },
      strong: volumeToLiquidity1h! >= 8,
    });
  }
  if (top10Pct < 15 && ((txs5m ?? 0) >= 400 || (txs1h ?? 0) >= 4_000)) {
    signals.push({
      factor: { label: `Distributed botting: low top-10 holdings with extreme activity`, severity: 'high', points: 18 },
      strong: true,
    });
  }
  if (earlyUniqueBuyers >= 60 && mintEarlyTxs.length > 0) {
    signals.push({
      factor: { label: `${earlyUniqueBuyers} unique early buyers in first ${mintEarlyTxs.length} mint txs`, severity: 'medium', points: 10 },
      strong: false,
    });
  }

  factors.push(...signals.map(signal => signal.factor));
  factors.sort((a, b) => b.points - a.points);

  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  const strongSignals = signals.filter(signal => signal.strong).length;
  const level: BotActivityScore['level'] =
    score >= SCORE_RED && strongSignals >= 2 ? 'red' : score >= SCORE_YELLOW ? 'yellow' : 'green';

  return {
    score,
    level,
    confidence: confidenceFor(mintEarlyTxs.length, txs5m !== undefined || txs1h !== undefined),
    factors,
    metrics: {
      earlyUniqueBuyers,
      sameSlotGroupCount,
      maxSameSlotBuyers,
      txs5m,
      txs1h,
      buySellRatio5m,
      buySellRatio1h,
      volumeToLiquidity1h,
    },
  };
}

export function mergeEntryRiskScore(rugScore: RugScore, botScore: BotActivityScore): RugScore {
  if (botScore.level === 'green') return rugScore;

  const level = botScore.level === 'red' || rugScore.level === 'red'
    ? 'red'
    : 'yellow';
  const score = Math.max(rugScore.score, botScore.score);
  const botFactors = botScore.factors.map(factor => ({
    ...factor,
    label: `Unsafe entry: ${factor.label}`,
  }));
  const factors = [...botFactors, ...rugScore.factors].sort((a, b) => b.points - a.points);

  return {
    ...rugScore,
    score,
    level,
    confidence: maxConfidence(rugScore.confidence, botScore.confidence),
    factors,
  };
}

function getEarlySlotGroups(mintAddress: string, txs: ParsedMintTx[]) {
  const groups = new Map<number, Set<string>>();
  for (const tx of txs) {
    for (const balance of tx.meta?.postTokenBalances ?? []) {
      const amount = balance.uiTokenAmount?.uiAmount ?? 0;
      if (balance.mint !== mintAddress || !balance.owner || amount <= 0) continue;
      if (!groups.has(tx.slot)) groups.set(tx.slot, new Set());
      groups.get(tx.slot)!.add(balance.owner);
    }
  }
  return [...groups.entries()].map(([slot, owners]) => ({ slot, owners: [...owners], wallets: owners.size }));
}

function sumTxns(txns: { buys: number; sells: number } | undefined): number | undefined {
  if (!txns) return undefined;
  return txns.buys + txns.sells;
}

function ratio(buys: number | undefined, sells: number | undefined): number | undefined {
  if (buys === undefined || sells === undefined) return undefined;
  return buys / Math.max(1, sells);
}

function confidenceFor(hasEarlyTxs: number, hasMarketActivity: boolean): BotActivityScore['confidence'] {
  if (hasEarlyTxs > 0 && hasMarketActivity) return 'high';
  if (hasEarlyTxs > 0 || hasMarketActivity) return 'medium';
  return 'low';
}

function maxConfidence(a: RugScore['confidence'], b: BotActivityScore['confidence']): RugScore['confidence'] {
  if (a === 'high' || b === 'high') return 'high';
  if (a === 'medium' || b === 'medium') return 'medium';
  return 'low';
}

function formatCount(value: number | undefined): string {
  return value === undefined ? 'n/a' : String(value);
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? 'n/a' : `${value.toFixed(1)}:1`;
}
