import type { ScanResultLike } from '@/lib/telegram/format';
import type { RugScore } from '@/lib/types';

// Discord forensic card as a rich EMBED — colored sidebar by rug level, structured
// inline 3-across fields (Rick/BONKbot convention), thumbnail logo, no emoji blobs.
// Reads the same ScanResultLike shape the Telegram/X cards do. Used by both the
// slash-command path and the gateway auto-detect path.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ricomaps.fun').replace(/\/$/, '');

// Sidebar colors keyed to the rug verdict — the at-a-glance signal.
const RUG_COLORS: Record<string, number> = {
  red: 0xef4444,
  yellow: 0xf59e0b,
  green: 0x22c55e,
};
const NEUTRAL_COLOR = 0x6b7280;

/** A row of link buttons (bubble map + Axiom + Solscan) for a scanned token. */
export function discordLinkRow(mint: string): unknown[] {
  return [{
    type: 1, // action row
    components: [
      { type: 2, style: 5, label: '🫧 Bubble Map', url: `${APP_URL}/?mint=${mint}` },
      { type: 2, style: 5, label: '⚡ Axiom', url: `https://axiom.trade/t/${mint}` },
      { type: 2, style: 5, label: 'Solscan', url: `https://solscan.io/token/${mint}` },
    ],
  }];
}

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

  // Row 1 — market stats, 3 across (the Rick/BONKbot convention).
  const mc = usd(meta?.marketCap);
  const lp = usd(meta?.liquidity);
  const vol = usd(meta?.volume24h);
  fields.push({ name: '💰 Market Cap', value: mc ?? 'n/a', inline: true });
  fields.push({ name: '💧 Liquidity', value: lp ?? 'n/a', inline: true });
  fields.push({ name: '📊 24h Vol', value: vol ?? 'n/a', inline: true });

  // Row 2 — holder structure, 3 across.
  if (sc) {
    fields.push({ name: '👥 Holders', value: stats.totalHolders != null ? `${stats.totalHolders}` : 'n/a', inline: true });
    fields.push({ name: '🔝 Top 10', value: pct(sc.top10Pct), inline: true });
    fields.push({ name: '🤝 Cabal', value: pct(sc.cabalSupplyPct), inline: true });
  }

  // Row 3 — launch insiders, 3 across (none vs % so a 0 doesn't read as a clean bill).
  if (sc) {
    const bundled = (stats.bundleClustersDetected ?? 0) > 0 ? pct(sc.bundledSupplyPct) : 'none';
    const snipers = (stats.snipersDetected ?? 0) > 0 ? pct(sc.sniperSupplyPct) : 'none';
    const hq = stats.holderQuality;
    fields.push({ name: '📦 Bundled', value: bundled, inline: true });
    fields.push({ name: '🎯 Snipers', value: snipers, inline: true });
    fields.push({
      name: '🏆 Top Holders',
      value: hq && hq.analyzed > 0 ? `${hq.winners}W / ${hq.exitLiquidity}E` : 'n/a',
      inline: true,
    });
  }

  // Security + dev — one full-width field (no blob emojis).
  if (sec || dep) {
    const parts: string[] = [];
    if (dep) {
      parts.push(dep.isRugDev
        ? `Dev ⛔ **rug dev** (${dep.priorRugCount} prior)`
        : dep.isSerialDeployer
        ? `Dev 🔴 serial${dep.pastLaunchCount != null ? ` (${dep.pastLaunchCount})` : ''}`
        : 'Dev 🟢 clean');
    }
    if (sec) {
      parts.push(`Mint ${authFlag(sec.hasMintAuthority, 'safe', 'live')}`);
      parts.push(`Freeze ${authFlag(sec.hasFreezeAuthority, 'safe', 'live')}`);
    }
    fields.push({ name: '🔒 Security', value: parts.join('  ·  '), inline: false });
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

  // Verdict in the description under the CA, so the rug score leads visually.
  const verdict = rug
    ? `${rugDot(rug.level)} **Rug ${rug.score}/100**${rug.factors?.[0]?.label ? ` — ${rug.factors[0].label}` : ''}`
    : '';

  return {
    title: `${name}${sym}`,
    url: `${APP_URL}/?mint=${mint}`,
    description: `\`${mint}\`\n${verdict}`,
    color,
    fields,
    thumbnail: resolveThumb(meta?.image),
    footer: { text: 'RicoMaps · Solana forensic intel' },
  };
}
