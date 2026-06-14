import type { ScanResultLike } from '@/lib/telegram/format';
import type { RugScore } from '@/lib/types';

// Discord renders Markdown, not Telegram HTML. This is a thin adapter that produces
// the same forensic card content as telegram/format.ts using Discord-safe markdown
// (** bold **, ` code `). Kept separate so the two channels can diverge cosmetically
// without coupling, but both read from the identical ScanResultLike shape.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ricomaps.fun').replace(/\/$/, '');

function rugEmoji(level: RugScore['level'] | undefined): string {
  if (level === 'red') return '🔴';
  if (level === 'yellow') return '🟡';
  if (level === 'green') return '🟢';
  return '⚪️';
}

function pct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return 'n/a';
  return `${n.toFixed(1)}%`;
}

function usd(n: number | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

/** Build the Discord forensic card (markdown string). */
export function formatDiscordCard(mint: string, result: ScanResultLike): string {
  const { stats, tokenMetadata: meta, tokenSecurity: sec, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;

  const name = meta?.name ?? 'Unknown token';
  const sym = meta?.symbol ? ` ($${meta.symbol})` : '';

  const lines: string[] = [];
  lines.push(`${rugEmoji(rug?.level)} **${name}**${sym}`);
  lines.push(`\`${mint}\``);
  if (rug) lines.push(`${rugEmoji(rug.level)} **Rug ${rug.score}/100**${rug.factors?.[0]?.label ? ` · ${rug.factors[0].label}` : ''}`);

  // Market
  const m: string[] = [];
  const mc = usd(meta?.marketCap);
  if (mc) m.push(`MC ${mc}`);
  const vol = usd(meta?.volume24h);
  if (vol) m.push(`Vol ${vol}`);
  const lp = usd(meta?.liquidity);
  if (lp) m.push(`LP ${lp}`);
  if (stats.totalHolders != null) m.push(`👀 ${stats.totalHolders}`);
  if (m.length) lines.push(m.join(' · '));

  // RicoMaps intel
  if (sc) {
    const bundled = (stats.bundleClustersDetected ?? 0) > 0 ? pct(sc.bundledSupplyPct) : 'none';
    const snipers = (stats.snipersDetected ?? 0) > 0 ? pct(sc.sniperSupplyPct) : 'none';
    lines.push('');
    lines.push(`🔬 **Intel** · cabal ${pct(sc.cabalSupplyPct)} · bundled ${bundled} · snipers ${snipers} · top10 ${pct(sc.top10Pct)}`);
  }

  // Holder quality
  const hq = stats.holderQuality;
  if (hq && hq.analyzed > 0) {
    lines.push(`💰 **Top ${hq.analyzed} holders** · ${hq.winners} winners · ${hq.exitLiquidity} exit liquidity`);
  }

  // Security + dev
  if (sec || dep) {
    const s: string[] = [];
    if (dep) {
      s.push(dep.isRugDev
        ? `⛔ rug dev (${dep.priorRugCount} prior)`
        : dep.isSerialDeployer
        ? `dev serial${dep.pastLaunchCount != null ? ` (${dep.pastLaunchCount})` : ''}`
        : 'dev clean');
    }
    if (sec) {
      s.push(sec.hasMintAuthority ? 'mint🔴' : 'mint🟢');
      s.push(sec.hasFreezeAuthority ? 'freeze🔴' : 'freeze🟢');
    }
    if (s.length) lines.push(`🔒 **Security** · ${s.join(' · ')}`);
  }

  // Cross-token + recycled-X signals
  const fpMatches = stats.cabalFingerprint?.matches?.length ?? 0;
  if (fpMatches > 0) lines.push(`🚩 **${fpMatches} known bundler${fpMatches === 1 ? '' : 's'}** seen on prior launches`);
  const x = result.xAccount;
  if (x?.isRecycled && x.priorUsernames.length > 0) {
    lines.push(`♻️ **Recycled X account** — @${x.currentUsername} was @${x.priorUsernames.slice(0, 3).join(', @')}`);
  }

  lines.push('');
  lines.push(`🫧 [Bubble map](${APP_URL}/?mint=${mint}) · [Solscan](https://solscan.io/token/${mint})`);
  return lines.join('\n');
}
