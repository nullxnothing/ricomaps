import { GraphData, TokenMetadata, DeployerInfo, SupplyConcentration, RugScore, CabalFingerprintResult } from './types';

// A token-efficient distillation of a token scan, aggregates only, never the raw
// graph, so the prompt stays a few hundred tokens regardless of holder count.
export interface NarrativeBrief {
  token: { name?: string; symbol?: string; rugScore?: number; rugLevel?: string };
  supply?: {
    top10Pct: number; bundledPct: number; sniperPct: number; cabalPct: number;
    gini: number; freshWalletPct: number; realHolders: number; coveragePct?: number;
  };
  deployer?: {
    isSerial: boolean; pastLaunches: number | null; stillHolds: boolean | null;
    heldPct: number | null; fundedBySource: string | null;
  };
  cabal: { funderCount: number; connectedHolders: number; fingerprintMatches: number };
  snipers: number;
  bundles: number;
  priorRapSheet: { symbol?: string; rugLevel?: string }[];
}

export interface NarrativeStatsInput {
  snipersDetected?: number;
  bundleClustersDetected?: number;
  supplyConcentration?: SupplyConcentration;
  rugScore?: RugScore;
  cabalFingerprint?: CabalFingerprintResult;
}

export function buildNarrativeBrief(input: {
  data: GraphData;
  stats: NarrativeStatsInput;
  tokenMetadata: TokenMetadata | null;
  deployerInfo: DeployerInfo | null;
}): NarrativeBrief {
  const { data, stats, tokenMetadata, deployerInfo } = input;

  const cabalFunders = data.nodes.filter(n => n.type === 'cabal-funder').length;
  const connectedHolders = data.nodes.filter(n => n.type === 'connected' || n.metadata?.sharedFunderGroup).length;
  const sc = stats.supplyConcentration;

  const priorRapSheet = (stats.cabalFingerprint?.matches ?? [])
    .flatMap(m => m.tokens)
    .slice(0, 6)
    .map(t => ({ symbol: t.tokenSymbol, rugLevel: t.rugLevel }));

  return {
    token: {
      name: tokenMetadata?.name,
      symbol: tokenMetadata?.symbol,
      rugScore: stats.rugScore?.score,
      rugLevel: stats.rugScore?.level,
    },
    supply: sc ? {
      top10Pct: sc.top10Pct, bundledPct: sc.bundledSupplyPct, sniperPct: sc.sniperSupplyPct,
      cabalPct: sc.cabalSupplyPct, gini: sc.giniCoefficient, freshWalletPct: sc.freshWalletPct,
      realHolders: sc.realHolderCount, coveragePct: sc.analyzedSupplyPct,
    } : undefined,
    deployer: deployerInfo ? {
      isSerial: deployerInfo.isSerialDeployer, pastLaunches: deployerInfo.pastLaunchCount,
      stillHolds: deployerInfo.stillHolds, heldPct: deployerInfo.heldSupplyPct,
      fundedBySource: deployerInfo.fundedBy?.source ?? null,
    } : undefined,
    cabal: {
      funderCount: cabalFunders,
      connectedHolders,
      fingerprintMatches: stats.cabalFingerprint?.matches.length ?? 0,
    },
    snipers: stats.snipersDetected ?? 0,
    bundles: stats.bundleClustersDetected ?? 0,
    priorRapSheet,
  };
}

function pct(n: number | undefined): string {
  return n === undefined ? 'n/a' : `${n.toFixed(1)}%`;
}

/** Compact structured text block for the user message. */
export function briefToPromptText(b: NarrativeBrief): string {
  const lines: string[] = [];
  lines.push(`TOKEN: ${b.token.name ?? 'Unknown'} ($${b.token.symbol ?? '???'})`);
  if (b.token.rugScore !== undefined) lines.push(`RUG SCORE: ${b.token.rugScore}/100 (${b.token.rugLevel})`);

  if (b.supply) {
    lines.push(
      `SUPPLY: top10=${pct(b.supply.top10Pct)}, bundled=${pct(b.supply.bundledPct)}, sniped=${pct(b.supply.sniperPct)}, ` +
      `cabal=${pct(b.supply.cabalPct)}, fresh-wallets=${pct(b.supply.freshWalletPct)}, gini=${b.supply.gini.toFixed(2)}, ` +
      `real-holders=${b.supply.realHolders}, coverage=${pct(b.supply.coveragePct)}`
    );
  }

  if (b.deployer) {
    const d = b.deployer;
    lines.push(
      `DEPLOYER: serial=${d.isSerial} pastLaunches=${d.pastLaunches ?? 'unknown'} ` +
      `stillHolds=${d.stillHolds === null ? 'unknown' : d.stillHolds} held=${pct(d.heldPct ?? undefined)} ` +
      `fundedBy=${d.fundedBySource ?? 'unknown'}`
    );
  }

  lines.push(`CABAL: ${b.cabal.funderCount} shared funder(s) feeding ${b.cabal.connectedHolders} holder(s)`);
  lines.push(`SNIPERS: ${b.snipers} | BUNDLES: ${b.bundles}`);

  if (b.cabal.fingerprintMatches > 0) {
    const prior = b.priorRapSheet.map(t => `$${t.symbol ?? '?'}${t.rugLevel === 'red' ? ' (rugged)' : ''}`).join(', ');
    lines.push(`KNOWN CREW: this funding fingerprint matches ${b.cabal.fingerprintMatches} prior token(s): ${prior}`);
  }

  return lines.join('\n');
}

export const NARRATIVE_SYSTEM_PROMPT = `You are a Solana on-chain forensics analyst writing for degen traders.
Given a distilled token scan, write a tight plain-English account of what the wallets did and what it means for risk.
Rules:
- 3-5 sentences, no preamble, no headers, no bullet lists. One flowing paragraph.
- Lead with the single most important finding (the rug verdict or the cabal).
- Name concrete numbers from the brief (percentages, counts). Do not invent data not in the brief.
- If a known crew / prior rugs are present, call it out explicitly. That is the headline.
- End with a blunt one-line read on whether this looks coordinated/risky or clean.
- Tone: sharp, direct, trader-native. No hedging, no disclaimers, no "always DYOR".
- Never use em dashes or en dashes. Use commas, colons, or periods instead.`;

/** Confidence derived from coverage, not the model. */
export function narrativeConfidence(coveragePct: number | undefined): 'high' | 'medium' | 'low' {
  if (coveragePct === undefined) return 'medium';
  if (coveragePct >= 60) return 'high';
  if (coveragePct < 30) return 'low';
  return 'medium';
}
