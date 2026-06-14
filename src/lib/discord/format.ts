import type { ScanResultLike } from '@/lib/telegram/format';
import type { RugScore } from '@/lib/types';

// Discord forensic card as a rich EMBED — colored sidebar by rug level, structured
// inline fields, no oversized emoji blobs. Reads the same ScanResultLike shape the
// Telegram/X cards do. A plain-string fallback (formatDiscordCard) is kept for the
// gateway auto-detect path where an embed object isn't convenient.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ricomaps.fun').replace(/\/$/, '');

// Sidebar colors keyed to the rug verdict — the at-a-glance signal.
const RUG_COLORS: Record<string, number> = {
  red: 0xef4444,
  yellow: 0xf59e0b,
  green: 0x22c55e,
};
const NEUTRAL_COLOR = 0x6b7280;

export interface DiscordEmbedField { name: string; value: string; inline?: boolean }
export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
  footer?: { text: string };
}

function rugDot(level: RugScore['level'] | undefined): string {
  if (level === 'red') return '🔴';
  if (level === 'yellow') return '🟡';
  if (level === 'green') return '🟢';
  return '⚪';
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

// Plain ✓ / ✕ for authority flags reads far cleaner than colored-circle emoji,
// which Discord blows up to full-size blocks mid-line.
function authFlag(bad: boolean | undefined, goodLabel: string, badLabel: string): string {
  return bad ? `\`${badLabel}\`` : `\`${goodLabel}\``;
}

function resolveThumb(image: string | undefined): { url: string } | undefined {
  if (!image) return undefined;
  if (image.startsWith('ipfs://')) return { url: `https://ipfs.io/ipfs/${image.slice('ipfs://'.length)}` };
  if (image.startsWith('https://')) return { url: image };
  return undefined;
}

/** Build the Discord forensic card as a rich embed. */
export function formatDiscordEmbed(mint: string, result: ScanResultLike): DiscordEmbed {
  const { stats, tokenMetadata: meta, tokenSecurity: sec, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;

  const name = meta?.name ?? 'Unknown token';
  const sym = meta?.symbol ? ` ($${meta.symbol})` : '';
  const color = (rug?.level && RUG_COLORS[rug.level]) || NEUTRAL_COLOR;

  const fields: DiscordEmbedField[] = [];

  // Rug verdict — full-width, leads the card.
  if (rug) {
    const factor = rug.factors?.[0]?.label ? ` · ${rug.factors[0].label}` : '';
    fields.push({ name: `${rugDot(rug.level)} Rug Score`, value: `**${rug.score}/100**${factor}`, inline: false });
  }

  // Market — three inline cells.
  const mc = usd(meta?.marketCap);
  const vol = usd(meta?.volume24h);
  const lp = usd(meta?.liquidity);
  if (mc) fields.push({ name: 'Market Cap', value: mc, inline: true });
  if (vol) fields.push({ name: '24h Volume', value: vol, inline: true });
  if (lp) fields.push({ name: 'Liquidity', value: lp, inline: true });

  // Supply intel — one rich field.
  if (sc) {
    const bundled = (stats.bundleClustersDetected ?? 0) > 0 ? pct(sc.bundledSupplyPct) : 'none';
    const snipers = (stats.snipersDetected ?? 0) > 0 ? pct(sc.sniperSupplyPct) : 'none';
    fields.push({
      name: '🔬 Supply Intel',
      value: `Cabal **${pct(sc.cabalSupplyPct)}** · Bundled **${bundled}** · Snipers **${snipers}** · Top 10 **${pct(sc.top10Pct)}**`,
      inline: false,
    });
  }

  // Holder quality.
  const hq = stats.holderQuality;
  if (hq && hq.analyzed > 0) {
    fields.push({
      name: '💰 Holder PnL',
      value: `Top ${hq.analyzed} · **${hq.winners}** winners · **${hq.exitLiquidity}** exit liquidity`,
      inline: false,
    });
  }

  // Security + dev — one field, no blob emojis.
  if (sec || dep) {
    const parts: string[] = [];
    if (dep) {
      parts.push(dep.isRugDev
        ? `Dev: ⛔ **rug dev** (${dep.priorRugCount} prior)`
        : dep.isSerialDeployer
        ? `Dev: 🔴 serial${dep.pastLaunchCount != null ? ` (${dep.pastLaunchCount})` : ''}`
        : 'Dev: 🟢 clean');
    }
    if (sec) {
      parts.push(`Mint ${authFlag(sec.hasMintAuthority, 'safe', 'live')}`);
      parts.push(`Freeze ${authFlag(sec.hasFreezeAuthority, 'safe', 'live')}`);
    }
    fields.push({ name: '🔒 Security', value: parts.join(' · '), inline: false });
  }

  // Cross-token + recycled-X red flags — only when present.
  const flags: string[] = [];
  const fpMatches = stats.cabalFingerprint?.matches?.length ?? 0;
  if (fpMatches > 0) flags.push(`🚩 **${fpMatches}** known bundler${fpMatches === 1 ? '' : 's'} on prior launches`);
  const x = result.xAccount;
  if (x?.isRecycled && x.priorUsernames.length > 0) {
    flags.push(`♻️ Recycled X: @${x.currentUsername} was @${x.priorUsernames.slice(0, 3).join(', @')}`);
  }
  if (flags.length) fields.push({ name: '⚠️ Flags', value: flags.join('\n'), inline: false });

  const holders = stats.totalHolders != null ? ` · 👀 ${stats.totalHolders} holders` : '';

  return {
    title: `${rugDot(rug?.level)} ${name}${sym}`,
    url: `${APP_URL}/?mint=${mint}`,
    description: `\`${mint}\``,
    color,
    fields,
    thumbnail: resolveThumb(meta?.image),
    footer: { text: `RicoMaps · forensic intel${holders}` },
  };
}

/**
 * Plain-string card (markdown) — used by the gateway auto-detect path and as a
 * fallback. Same content, condensed.
 */
export function formatDiscordCard(mint: string, result: ScanResultLike): string {
  const { stats, tokenMetadata: meta, tokenSecurity: sec, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;
  const name = meta?.name ?? 'Unknown token';
  const sym = meta?.symbol ? ` ($${meta.symbol})` : '';

  const lines = [`${rugDot(rug?.level)} **${name}**${sym}  \`${mint}\``];
  if (rug) lines.push(`Rug **${rug.score}/100**${rug.factors?.[0]?.label ? ` · ${rug.factors[0].label}` : ''}`);
  const market = [usd(meta?.marketCap) && `MC ${usd(meta?.marketCap)}`, usd(meta?.volume24h) && `Vol ${usd(meta?.volume24h)}`, stats.totalHolders != null && `👀 ${stats.totalHolders}`].filter(Boolean);
  if (market.length) lines.push(market.join(' · '));
  if (sc) {
    const bundled = (stats.bundleClustersDetected ?? 0) > 0 ? pct(sc.bundledSupplyPct) : 'none';
    const snipers = (stats.snipersDetected ?? 0) > 0 ? pct(sc.sniperSupplyPct) : 'none';
    lines.push(`🔬 cabal ${pct(sc.cabalSupplyPct)} · bundled ${bundled} · snipers ${snipers} · top10 ${pct(sc.top10Pct)}`);
  }
  const hq = stats.holderQuality;
  if (hq && hq.analyzed > 0) lines.push(`💰 ${hq.winners} winners · ${hq.exitLiquidity} exit liquidity`);
  const fpMatches = stats.cabalFingerprint?.matches?.length ?? 0;
  if (fpMatches > 0) lines.push(`🚩 ${fpMatches} known bundler${fpMatches === 1 ? '' : 's'} on prior launches`);
  const x = result.xAccount;
  if (x?.isRecycled && x.priorUsernames.length > 0) lines.push(`♻️ recycled X: @${x.priorUsernames.slice(0, 2).join(', @')}`);
  void sec; void dep;
  lines.push(`🫧 <${APP_URL}/?mint=${mint}>`);
  return lines.join('\n');
}
