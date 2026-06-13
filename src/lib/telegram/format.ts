import type {
  TokenSecurityInfo,
  TokenMetadata,
  DeployerInfo,
  RugScore,
  SupplyConcentration,
  CabalFingerprintResult,
} from '@/lib/types';
import { formatUsd, formatMarketCap } from '@/lib/format';
import { truncateAddress } from '@/lib/address-utils';
import type { InlineKeyboard } from './client';

// The card consumes the same shape mapTokenHolders() returns. Cache hydration
// gives `stats` as a loose record, so the consumed fields are all optional.
interface ScanStats {
  snipersDetected?: number;
  sniperWallets?: string[];
  bundleClustersDetected?: number;
  bundledWallets?: string[];
  supplyConcentration?: SupplyConcentration;
  rugScore?: RugScore;
  cabalFingerprint?: CabalFingerprintResult;
}

export interface ScanResultLike {
  stats: ScanStats;
  tokenSecurity: TokenSecurityInfo | null;
  tokenMetadata: TokenMetadata | null;
  deployerInfo: DeployerInfo | null;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ricomaps.fun').replace(/\/$/, '');

/** Escape the three characters that matter for Telegram HTML parse mode. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)}%`;
}

function rugEmoji(level: RugScore['level'] | undefined): string {
  if (level === 'red') return '🔴';
  if (level === 'yellow') return '🟡';
  if (level === 'green') return '🟢';
  return '⚪️';
}

/**
 * Build the forensic token card. Leads with RicoMaps-only intelligence
 * (rug verdict, insider/cabal/bundle/sniper supply), then the familiar
 * market block, then token security. Returns HTML text + an inline keyboard.
 */
export interface TokenCard {
  text: string;
  replyMarkup: InlineKeyboard;
  /** Token logo for sendPhoto; undefined → send as text card. */
  photoUrl?: string;
}

// Tree connectors — mid branch and last branch, matching the reference layout.
const T = '├';
const L = '└';

/** One tree row: connector + blue <code> label + value(s). */
function leaf(connector: string, label: string, value: string): string {
  return `${connector}<code>${label}</code> ${value}`;
}

/** A labeled section: heading line + tree rows under it. */
function section(emoji: string, title: string, rows: string[]): string[] {
  if (rows.length === 0) return [];
  return ['', `${emoji} <b>${title}</b>`, ...rows];
}

function signedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
}

export function formatTokenCard(mint: string, result: ScanResultLike): TokenCard {
  const { stats, tokenMetadata: meta, tokenSecurity: sec, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;

  const name = meta?.name ?? 'Unknown token';
  const sym = meta?.symbol ? `$${esc(meta.symbol)}` : '';

  const lines: string[] = [];

  // ── Header: pill · name (sym) · CA · rug verdict ─────────
  lines.push(`${rugEmoji(rug?.level)} <b>${esc(name)}</b>${sym ? ` (<b>${sym}</b>)` : ''}`);
  lines.push(`${L}<code>${esc(mint)}</code>`);
  if (rug) {
    const factor = rug.factors?.[0]?.label ? ` · ${esc(rug.factors[0].label)}` : '';
    lines.push(`${rugEmoji(rug.level)} <b>Rug ${rug.score}/100</b>${factor}`);
  }

  // ── Market ──────────────────────────────────────────────
  if (meta) {
    const m: string[] = [];
    if (meta.priceUsd != null) m.push(leaf(T, 'USD ', `$${meta.priceUsd < 0.01 ? meta.priceUsd.toPrecision(2) : meta.priceUsd.toFixed(4)}`));
    if (meta.marketCap != null) m.push(leaf(T, 'MC  ', `<u>${formatMarketCap(meta.marketCap)}</u>`));
    if (meta.volume24h != null) m.push(leaf(T, 'Vol ', formatUsd(meta.volume24h)));
    if (meta.liquidity != null) m.push(leaf(T, 'LP  ', formatUsd(meta.liquidity)));
    if (meta.priceChange24h != null) {
      const dot = meta.priceChange24h >= 0 ? '🟢' : '🔴';
      m.push(leaf(L, '24h ', `${signedPct(meta.priceChange24h)} ${dot}`));
    }
    if (m.length) lines.push(...section('📊', 'Stats', m));
  }

  // ── RicoMaps Intel — the differentiator ─────────────────
  if (sc) {
    const bundleN = stats.bundledWallets?.length ?? 0;
    const clusterN = stats.bundleClustersDetected ?? 0;
    const sniperN = stats.sniperWallets?.length ?? stats.snipersDetected ?? 0;
    const intel = [
      leaf(T, 'Insider ', `<b>${pct(sc.insiderStillHoldingPct)}</b> <i>still holding</i>`),
      leaf(T, 'Cabal   ', `<b>${pct(sc.cabalSupplyPct)}</b> <i>shared funder</i>`),
      leaf(T, 'Bundled ', `<b>${pct(sc.bundledSupplyPct)}</b> <i>${bundleN}w · ${clusterN} bundles</i>`),
      leaf(L, 'Snipers ', `<b>${pct(sc.sniperSupplyPct)}</b> <i>${sniperN} wallets</i>`),
    ];
    lines.push(...section('🔬', 'RicoMaps Intel', intel));
  }

  // ── Security ────────────────────────────────────────────
  if (sec || sc || dep) {
    const s: string[] = [];
    if (sc) s.push(leaf(T, 'Fresh ', `<b>${pct(sc.freshWalletPct)}</b>`));
    if (sc) s.push(leaf(T, 'Top 10', ` <b>${pct(sc.top10Pct)}</b> <i>(${sc.realHolderCount} holders)</i>`));
    if (dep) {
      const d = dep.isSerialDeployer
        ? `🔴 <b>serial</b>${dep.pastLaunchCount != null ? ` <i>(${dep.pastLaunchCount} launches)</i>` : ''}`
        : '🟢 clean';
      const holds = dep.stillHolds === true && dep.heldSupplyPct != null ? ` · holds ${pct(dep.heldSupplyPct)}`
        : dep.stillHolds === false ? ' · sold' : '';
      s.push(leaf(T, 'Dev   ', `${d}${holds}`));
    }
    if (sec) {
      const flags = [
        sec.hasMintAuthority ? 'Mint🔴' : 'Mint🟢',
        sec.hasFreezeAuthority ? 'Freeze🔴' : 'Freeze🟢',
        sec.isMutable ? 'Mut🔴' : 'Immut🟢',
      ].join(' ');
      s.push(leaf(L, 'Auth  ', flags));
    }
    lines.push(...section('🔒', 'Security', s));
  }

  // ── Known bundlers (blacklist hit) ──────────────────────
  const fpMatches = stats.cabalFingerprint?.matches?.length ?? 0;
  if (fpMatches > 0) {
    lines.push('');
    lines.push(`🚩 <b>${fpMatches} known bundler${fpMatches === 1 ? '' : 's'}</b> <i>seen on prior launches</i>`);
  }

  const text = lines.join('\n');

  const dexUrl = meta?.dexUrl ?? `https://dexscreener.com/solana/${mint}`;
  const replyMarkup: InlineKeyboard = [
    [{ text: '🫧 Live Bubble Map ↗', url: `${APP_URL}/?mint=${mint}` }],
    [
      { text: '🔔 Watch', callback_data: `watch:${mint}` },
      { text: 'DexScreener ↗', url: dexUrl },
      { text: 'Solscan ↗', url: `https://solscan.io/token/${mint}` },
    ],
  ];

  return { text, replyMarkup, photoUrl: resolvePhotoUrl(meta?.image) };
}

/**
 * Telegram fetches the photo URL itself. Accept https logos directly and rewrite
 * ipfs:// to a gateway; reject anything else (data URIs, http) so sendPhoto won't 400.
 */
function resolvePhotoUrl(image: string | undefined): string | undefined {
  if (!image) return undefined;
  if (image.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${image.slice('ipfs://'.length)}`;
  if (image.startsWith('https://')) return image;
  return undefined;
}

/** Short one-line summary used for inline-query result titles. */
export function inlineSummary(mint: string, result: ScanResultLike): string {
  const rug = result.stats.rugScore;
  const sc = result.stats.supplyConcentration;
  const sym = result.tokenMetadata?.symbol ? `$${result.tokenMetadata.symbol}` : truncateAddress(mint);
  const score = rug ? `${rug.score}/100` : '—';
  const insider = sc ? ` · insider ${pct(sc.insiderStillHoldingPct)}` : '';
  return `${rugEmoji(rug?.level)} ${sym} — rug ${score}${insider}`;
}
