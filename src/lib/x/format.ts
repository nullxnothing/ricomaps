import type { ScanResultLike } from '@/lib/scan-core';
import type { RugScore } from '@/lib/types';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ricomaps.fun').replace(/\/$/, '');

// X counts every URL as 23 chars (t.co), regardless of real length.
const TWEET_LIMIT = 280;
const URL_WEIGHT = 23;

function rugEmoji(level: RugScore['level'] | undefined): string {
  if (level === 'red') return '🔴';
  if (level === 'yellow') return '🟡';
  if (level === 'green') return '🟢';
  return '⚪️';
}

function pct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return 'n/a';
  return `${Math.round(n)}%`;
}

/** Compact age from a unix-seconds launch timestamp: 45m, 2h, 3d, 5mo. */
function age(launchTs: number | undefined): string | null {
  if (!launchTs || launchTs <= 0) return null;
  const mins = (Date.now() / 1000 - launchTs) / 60;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  if (mins < 43200) return `${Math.round(mins / 1440)}d`;
  return `${Math.round(mins / 43200)}mo`;
}

/** Compact USD: $76M, $910K, $1.2K. */
function usd(n: number | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/** Visible length of a line where the trailing map URL counts as 23 chars. */
function weightedLength(line: string, mapUrl: string): number {
  return line.includes(mapUrl) ? line.length - mapUrl.length + URL_WEIGHT : line.length;
}

// Tree connectors, mirroring the Telegram card so both channels read the same.
const T = '├';
const L = '└';

/**
 * Build a compact plain-text X reply (no HTML, no buttons) for a token scan.
 * Single tweet, <=280 chars, laid out as a tree to match the Telegram card.
 *
 * Header line is always kept; the body rows degrade from the bottom up, and the
 * last surviving body row is re-tagged with the └ connector so the tree never
 * ends on a ├. The map link always trails after a blank separator.
 */
export function formatXReply(mint: string, result: ScanResultLike): string {
  const { stats, tokenMetadata: meta, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;

  const sym = meta?.symbol ? `$${meta.symbol}` : (meta?.name ?? 'Token');
  const mapUrl = `${APP_URL}/?mint=${mint}`;

  // Header: pill · symbol · rug verdict. Always kept.
  const header = rug
    ? `${rugEmoji(rug.level)} ${sym} · rug ${rug.score}/100`
    : `${rugEmoji(undefined)} ${sym}`;

  // Body rows, priority-ordered. Connectors are assigned after we know which
  // rows survived the budget, so the tree is always well-formed.
  const rows: string[] = [];

  // Context: MC · age · holders — legitimacy at a glance.
  const ctx: string[] = [];
  const mc = usd(meta?.marketCap);
  if (mc) ctx.push(`MC ${mc}`);
  const tokenAge = age(meta?.launchTimestamp);
  if (tokenAge) ctx.push(tokenAge);
  if (stats.totalHolders != null) ctx.push(`👀 ${stats.totalHolders}`);
  if (ctx.length) rows.push(ctx.join(' · '));

  if (sc) {
    // "Not detected" shows as "—", never a bare 0% that reads as a clean bill.
    const bundled = (stats.bundleClustersDetected ?? 0) > 0 ? pct(sc.bundledSupplyPct) : '—';
    const snipers = (stats.snipersDetected ?? 0) > 0 ? pct(sc.sniperSupplyPct) : '—';
    rows.push(`cabal ${pct(sc.cabalSupplyPct)} · bundled ${bundled} · snipers ${snipers}`);
  }

  const devBits: string[] = [];
  if (dep) {
    devBits.push(dep.isSerialDeployer
      ? (dep.pastLaunchCount != null ? `dev serial (${dep.pastLaunchCount})` : 'dev serial')
      : 'dev clean');
  }
  const fpMatches = stats.cabalFingerprint?.matches?.length ?? 0;
  if (fpMatches > 0) devBits.push(`🚩 ${fpMatches} known bundler${fpMatches === 1 ? '' : 's'}`);
  if (devBits.length) rows.push(devBits.join(' · '));

  // CTA: the map link trails after a blank line. X folds a trailing URL into its
  // link-preview card, so the "full map:" label keeps the text reading cleanly.
  const ctaLine = `🔍 full map: ${mapUrl}`;

  // Assemble within budget. Reserve header + blank + CTA up front, then add body
  // rows top-down while they fit (each costs +2 for the connector prefix + \n).
  const reserved = header.length + 2 /*\n + blank*/ + 1 /*\n before cta*/ + weightedLength(ctaLine, mapUrl);
  let used = reserved;
  const kept: string[] = [];
  for (const row of rows) {
    const cost = row.length + 2 /*connector + space*/ + 1 /*\n*/;
    if (used + cost > TWEET_LIMIT) break;
    kept.push(row);
    used += cost;
  }

  // Prefix connectors: every row gets ├ except the last, which gets └.
  const body = kept.map((row, i) => `${i === kept.length - 1 ? L : T} ${row}`);

  return [header, ...body, '', ctaLine].join('\n');
}
