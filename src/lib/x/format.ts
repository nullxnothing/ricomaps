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

/**
 * Build a compact plain-text X reply (no HTML, no buttons) for a token scan.
 * Single tweet, <=280 chars. Lines are priority-ordered; if over budget we drop
 * from the bottom up, but the header and the map link are always kept.
 */
export function formatXReply(mint: string, result: ScanResultLike): string {
  const { stats, tokenMetadata: meta, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;

  const sym = meta?.symbol ? `$${meta.symbol}` : (meta?.name ?? 'Token');
  const mapUrl = `${APP_URL}/?mint=${mint}`;

  // Priority-ordered lines. [0] header and the final map line are mandatory.
  const header = rug
    ? `${rugEmoji(rug.level)} ${sym} · rug ${rug.score}/100`
    : `${rugEmoji(undefined)} ${sym}`;

  const optional: string[] = [];

  // Context line: MC · age · holders. Legitimacy at a glance, so a flagged score
  // on a big established token isn't read as "about to rug".
  const ctx: string[] = [];
  const mc = usd(meta?.marketCap);
  if (mc) ctx.push(`MC ${mc}`);
  const tokenAge = age(meta?.launchTimestamp);
  if (tokenAge) ctx.push(`${tokenAge} old`);
  if (stats.totalHolders != null) ctx.push(`👀 ${stats.totalHolders}`);
  if (ctx.length) optional.push(ctx.join(' · '));

  if (sc) {
    optional.push(`cabal ${pct(sc.cabalSupplyPct)} · bundled ${pct(sc.bundledSupplyPct)} · snipers ${pct(sc.sniperSupplyPct)}`);
  }

  const devBits: string[] = [];
  if (dep) {
    if (dep.isSerialDeployer) {
      devBits.push(dep.pastLaunchCount != null ? `dev: serial (${dep.pastLaunchCount})` : 'dev: serial');
    } else {
      devBits.push('dev: clean');
    }
  }
  const fpMatches = stats.cabalFingerprint?.matches?.length ?? 0;
  if (fpMatches > 0) devBits.push(`🚩 ${fpMatches} known bundler${fpMatches === 1 ? '' : 's'}`);
  if (devBits.length) optional.push(devBits.join(' · '));

  // The URL goes inline in a real CTA sentence. X strips a bare URL out of the
  // visible text when it builds the link-preview card, which would leave a
  // dangling emoji; phrasing it as "Full map: <url>" reads fine either way.
  const ctaLine = `Full bubble map ${mapUrl}`;

  // Assemble within budget: header + as many optional lines as fit, a blank
  // separator, then the CTA line. Budget reserves the blank line + CTA up front.
  const lines = [header];
  let used = header.length + 1 /*\n*/ + 1 /*blank line*/ + weightedLength(ctaLine, mapUrl);
  for (const line of optional) {
    const cost = line.length + 1;
    if (used + cost > TWEET_LIMIT) break;
    lines.push(line);
    used += cost;
  }
  lines.push('', ctaLine);
  return lines.join('\n');
}
