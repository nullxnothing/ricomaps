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

function resolveThumb(image: string | undefined): { url: string } | undefined {
  if (!image) return undefined;
  if (image.startsWith('ipfs://')) return { url: `https://ipfs.io/ipfs/${image.slice('ipfs://'.length)}` };
  if (image.startsWith('https://')) return { url: image };
  return undefined;
}

// Plain-language risk label from the rug level — leads the card so the verdict reads first.
function riskLabel(level: RugScore['level'] | undefined): string {
  if (level === 'red') return '🔴 High Risk';
  if (level === 'yellow') return '🟡 Medium Risk';
  if (level === 'green') return '🟢 Low Risk';
  return '⚪ Unrated';
}

/** Shorten an address to head…tail for inline display (full one lives behind buttons). */
function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * Build the Discord forensic card as a rich embed. Verdict-first: the risk label +
 * rug score + top-10 concentration lead in the description, then grouped blocks
 * (Market / Supply Risk / Developer / Security) with short labels and header-only
 * emojis, then a loud Flags block only when something is actually wrong.
 */
export function formatDiscordEmbed(mint: string, result: ScanResultLike): DiscordEmbed {
  const { stats, tokenMetadata: meta, tokenSecurity: sec, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;

  // Title: "Rico Maps • Name ($SYM)" — keeps brand + token identity in one line.
  const tokenLabel = meta?.symbol
    ? `${meta.name ? `${meta.name} ` : ''}($${meta.symbol})`
    : (meta?.name ?? 'Unknown token');
  const color = (rug?.level && RUG_COLORS[rug.level]) || NEUTRAL_COLOR;

  // ── Description: the verdict, read in 2 seconds ──
  const descLines: string[] = [`\`${mint}\``, ''];
  if (rug) {
    descLines.push(`**${riskLabel(rug.level)}** — Rug Score ${rug.score}/100`);
    if (sc) descLines.push(`Top 10 holders control ${pct(sc.top10Pct)}`);
  }

  const fields: DiscordEmbedField[] = [];

  // ── Market (one block, short labels) ──
  const market: string[] = [];
  if (usd(meta?.marketCap)) market.push(`MCap: ${usd(meta?.marketCap)}`);
  if (usd(meta?.liquidity)) market.push(`Liq: ${usd(meta?.liquidity)}`);
  if (usd(meta?.volume24h)) market.push(`24h Vol: ${usd(meta?.volume24h)}`);
  // Honest framing: this is the SAMPLE RicoMaps inspected, not the token's holder total.
  const analyzed = sc?.realHolderCount ?? stats.totalHolders;
  if (analyzed != null) market.push(`Holders checked: top ${analyzed}`);
  if (market.length) fields.push({ name: '📊 Market', value: market.join('\n'), inline: false });

  // ── Supply Risk (one block) ──
  if (sc) {
    // "none in top" — an established token whose early bundlers/snipers already exited
    // shows none here; that's not a verified clean bill, just not in the sample.
    const bundled = (stats.bundleClustersDetected ?? 0) > 0 ? pct(sc.bundledSupplyPct) : 'none in top';
    const snipers = (stats.snipersDetected ?? 0) > 0 ? pct(sc.sniperSupplyPct) : 'none in top';
    const supply = [
      `Top 10: ${pct(sc.top10Pct)}`,
      `Cabal: ${pct(sc.cabalSupplyPct)}`,
      `Bundled: ${bundled}`,
      `Snipers: ${snipers}`,
    ];
    const hq = stats.holderQuality;
    if (hq && hq.analyzed > 0) supply.push(`Top holders: ${hq.winners} winners / ${hq.exitLiquidity} exit liq`);
    fields.push({ name: '🧬 Supply Risk', value: supply.join('\n'), inline: false });
  }

  // ── Developer (one block) ──
  if (dep) {
    const history = dep.isRugDev
      ? `⛔ Rug dev — rugged ${dep.priorRugCount} prior token${dep.priorRugCount === 1 ? '' : 's'}`
      : dep.isSerialDeployer
      ? `Serial deployer${dep.pastLaunchCount != null ? ` — ${dep.pastLaunchCount} launches` : ''}`
      : dep.pastLaunchCount === 0
      ? 'No prior launches found'
      : 'Clean';
    const devLines = [history, `\`${shortAddr(dep.address)}\``];
    if (dep.stillHolds === true && dep.heldSupplyPct != null) devLines.push(`Holds ${pct(dep.heldSupplyPct)} of supply`);
    else if (dep.stillHolds === false) devLines.push('Sold its bag');
    if (dep.fundedBy?.source && dep.fundedBy.source !== 'UNKNOWN') devLines.push(`Funded via ${dep.fundedBy.source}`);
    fields.push({ name: '👨‍💻 Developer', value: devLines.join('\n'), inline: false });
  }

  // ── Security (one block) ──
  if (sec) {
    fields.push({
      name: '🔒 Security',
      value: [
        `Mint: ${sec.hasMintAuthority ? 'Live ⚠️' : 'Safe'}`,
        `Freeze: ${sec.hasFreezeAuthority ? 'Live ⚠️' : 'Safe'}`,
        `Metadata: ${sec.isMutable ? 'Mutable' : 'Fixed'}`,
      ].join('\n'),
      inline: false,
    });
  }

  // ── Flags (the only loud block — shown only when something's actually wrong) ──
  const flags: string[] = [];
  const fpMatches = stats.cabalFingerprint?.matches?.length ?? 0;
  if (fpMatches > 0) flags.push(`🔴 ${fpMatches} known bundler${fpMatches === 1 ? '' : 's'} found on prior launches`);
  const x = result.xAccount;
  if (x?.isRecycled && x.priorUsernames.length > 0) {
    flags.push(`🔴 Recycled X account — @${x.currentUsername} was @${x.priorUsernames.slice(0, 3).join(', @')}`);
  }
  if (flags.length) fields.push({ name: '🚩 Flags', value: flags.join('\n'), inline: false });

  const coverage = sc?.analyzedSupplyPct != null && sc.analyzedSupplyPct < 80
    ? ` covers ~${Math.round(sc.analyzedSupplyPct)}% of supply`
    : '';

  return {
    title: `Rico Maps • ${tokenLabel}`,
    url: `${APP_URL}/?mint=${mint}`,
    description: descLines.join('\n'),
    color,
    fields,
    thumbnail: resolveThumb(meta?.image),
    footer: { text: `RicoMaps top-holder forensics${coverage}` },
  };
}
