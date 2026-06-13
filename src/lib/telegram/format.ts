import type {
  TokenSecurityInfo,
  TokenMetadata,
  DeployerInfo,
  RugScore,
  SupplyConcentration,
  CabalFingerprintResult,
  CabalFingerprint,
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
  totalHolders?: number;
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

// Attribution / buy footer shown on every card and alert.
const RICO_MINT = process.env.NEXT_PUBLIC_RICO_MINT ?? '6tf2X4GbYdM59hAMNa5kgyja2C9CjwUVqr9YLvJ1pump';
const DAEMON_MINT = '4vpf4qNtNVkvz2dm5qL2mT6jBXH9gDY8qH2QsHN5pump';
export const FOOTER_ROW: InlineKeyboard = [
  [
    { text: '💸 Trade $RICO', url: `https://pump.fun/coin/${RICO_MINT}` },
    { text: '⚡ Built with Daemon', url: `https://pump.fun/coin/${DAEMON_MINT}` },
  ],
  [
    { text: '🐦 Follow / Support', url: 'https://x.com/RicoxMaps' },
  ],
];

/** Escape the three characters that matter for Telegram HTML parse mode. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return 'n/a';
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
  /** Token logo URL, rendered as a small preview thumbnail above the text card. */
  previewUrl?: string;
}

// Tree connectors: mid branch and last branch, matching the reference layout.
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

/** Compact age from a unix-seconds launch timestamp: 45m, 2h, 3d, 5mo. */
function age(launchTs: number | undefined): string | null {
  if (!launchTs || launchTs <= 0) return null;
  const mins = (Date.now() / 1000 - launchTs) / 60;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  if (mins < 43200) return `${Math.round(mins / 1440)}d`;
  return `${Math.round(mins / 43200)}mo`;
}

/** One inline <a> link for the in-message link rows. */
function lnk(label: string, url: string): string {
  return `<a href="${url}">${label}</a>`;
}

/** Normalize a raw social value (handle or URL) to a full https URL, or null. */
function socialUrl(kind: 'x' | 'tg' | 'web', raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v.replace(/^http:/i, 'https:');
  if (kind === 'x') return `https://x.com/${v.replace(/^@/, '')}`;
  if (kind === 'tg') return `https://t.me/${v.replace(/^@/, '')}`;
  return `https://${v}`;
}

/**
 * The token's own socials (X / Web / TG from metadata) as a single tappable text
 * line. Kept short so it fits inside a photo caption (1024-char cap). The longer
 * charts/trade-bot link grid lives on the buttons + the bubble map.
 */
function socialLine(meta: TokenMetadata | null): string[] {
  const socials: string[] = [];
  const x = socialUrl('x', meta?.twitter);
  const web = socialUrl('web', meta?.website);
  const tg = socialUrl('tg', meta?.telegram);
  if (x) socials.push(lnk('𝕏', x));
  if (web) socials.push(lnk('Web', web));
  if (tg) socials.push(lnk('TG', tg));
  return socials.length ? ['', `🔗 ${socials.join(' · ')}`] : [];
}

/**
 * The full charts/explorer + trade-bot + attribution link grid as a STANDALONE
 * text message. Sent as a follow-up to the photo card because the combined HTML
 * blows the 1024-char photo-caption cap. Disable link previews when sending this.
 */
export function formatLinksMessage(mint: string, dexUrl: string): string {
  const charts = [
    lnk('DS', dexUrl),
    lnk('GT', `https://www.geckoterminal.com/solana/pools/${mint}`),
    lnk('BE', `https://birdeye.so/token/${mint}?chain=solana`),
    lnk('SOL', `https://solscan.io/token/${mint}`),
    lnk('Xs', `https://x.com/search?q=${encodeURIComponent(mint)}`),
  ].join(' · ');
  const bots = [
    lnk('GMGN', `https://gmgn.ai/sol/token/${mint}`),
    lnk('AXI', `https://axiom.trade/t/${mint}`),
    lnk('TRO', `https://t.me/solana_trojanbot?start=${mint}`),
    lnk('BLOOM', `https://t.me/BloomSolana_bot?start=${mint}`),
    lnk('PHO', `https://photon-sol.tinyastro.io/en/lp/${mint}`),
    lnk('BULLX', `https://bullx.io/terminal?chainId=1399811149&address=${mint}`),
    lnk('MAE', `https://t.me/maestro?start=${mint}`),
  ].join(' · ');
  const attrib = `${lnk('💸 Trade $RICO', `https://pump.fun/coin/${RICO_MINT}`)} · ${lnk('⚡ Built with Daemon', `https://pump.fun/coin/${DAEMON_MINT}`)}`;
  return [`📈 ${charts}`, `🤖 ${bots}`, '', attrib].join('\n');
}

export function formatTokenCard(mint: string, result: ScanResultLike): TokenCard {
  const { stats, tokenMetadata: meta, tokenSecurity: sec, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;

  const name = meta?.name ?? 'Unknown token';
  const sym = meta?.symbol ? `$${esc(meta.symbol)}` : '';

  const lines: string[] = [];

  // ── Header: pill · name (sym) · CA · meta line · rug verdict ──
  lines.push(`${rugEmoji(rug?.level)} <b>${esc(name)}</b>${sym ? ` (<b>${sym}</b>)` : ''}`);
  lines.push(`${T}<code>${esc(mint)}</code>`);

  // Meta line: chain · curve · age · holders (the "#SOL | Pump @ 85% | 2h | 👀 196" row).
  const metaBits = ['#SOL'];
  // Bonding status: a live DEX pair / liquidity means the curve completed (graduated).
  if (meta?.pairAddress || (meta?.liquidity != null && meta.liquidity > 0)) metaBits.push('🎓 graduated');
  const tokenAge = age(meta?.launchTimestamp);
  if (tokenAge) metaBits.push(`🌱 ${tokenAge}`);
  if (stats.totalHolders != null) metaBits.push(`👀 ${stats.totalHolders}`);
  lines.push(`${L}<i>${metaBits.join('  |  ')}</i>`);

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

  // RicoMaps Intel: the differentiator.
  // Bundled/sniper are measured from launch-time buyers that are STILL in the
  // analyzed holder set. On older/distributed tokens those wallets have exited,
  // so detection legitimately finds none. Showing a bare "0.0%" reads as broken,
  // so when nothing is detected we surface "none in top holders" instead.
  if (sc) {
    const bundleN = stats.bundledWallets?.length ?? 0;
    const clusterN = stats.bundleClustersDetected ?? 0;
    const sniperN = stats.sniperWallets?.length ?? stats.snipersDetected ?? 0;

    const bundledVal = clusterN > 0
      ? `<b>${pct(sc.bundledSupplyPct)}</b> <i>${bundleN}w · ${clusterN} bundles</i>`
      : '<i>none in top holders</i>';
    const sniperVal = sniperN > 0
      ? `<b>${pct(sc.sniperSupplyPct)}</b> <i>${sniperN} wallets</i>`
      : '<i>none in top holders</i>';

    const intel = [
      leaf(T, 'Insider ', `<b>${pct(sc.insiderStillHoldingPct)}</b> <i>still holding</i>`),
      leaf(T, 'Cabal   ', `<b>${pct(sc.cabalSupplyPct)}</b> <i>shared funder</i>`),
      leaf(T, 'Bundled ', bundledVal),
      leaf(L, 'Snipers ', sniperVal),
    ];
    lines.push(...section('🔬', 'RicoMaps Intel', intel));

    // Coverage footer: how much supply the analyzed holders actually represent.
    // Critical scope so a low/zero metric isn't read as a clean bill of health.
    if (sc.analyzedSupplyPct != null && sc.analyzedSupplyPct < 60) {
      lines.push(`<i>📐 Analyzed ${pct(sc.analyzedSupplyPct)} of supply (top ${sc.realHolderCount} holders). Launch-time metrics may understate older tokens.</i>`);
    }
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

  // Token's own socials line, then the full link grid — all inline in one text
  // message (4096-char cap, plenty of room). The logo rides as a small preview.
  lines.push(...socialLine(meta));
  const dexUrl = meta?.dexUrl ?? `https://dexscreener.com/solana/${mint}`;
  lines.push('', formatLinksMessage(mint, dexUrl));

  const text = lines.join('\n');

  // Keyboard kept to actions only: map, refresh, rap sheet, watch, support.
  const replyMarkup: InlineKeyboard = [
    [
      { text: '🫧 Bubble Map ↗', url: `${APP_URL}/?mint=${mint}` },
      { text: '🔄 Refresh', callback_data: `refresh:${mint}` },
    ],
    ...(fpMatches > 0 ? [[{ text: `🚩 Bundler rap sheet (${fpMatches})`, callback_data: `rap:${mint}` }]] : []),
    [
      { text: '🔔 Watch', callback_data: `watch:${mint}` },
      { text: '🐦 Support', url: 'https://x.com/RicoxMaps' },
    ],
  ];

  return { text, replyMarkup, previewUrl: resolvePhotoUrl(meta?.image) };
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
  const score = rug ? `${rug.score}/100` : 'n/a';
  const insider = sc ? ` · insider ${pct(sc.insiderStillHoldingPct)}` : '';
  return `${rugEmoji(rug?.level)} ${sym} · rug ${score}${insider}`;
}

function ago(unixSec: number): string {
  const days = (Date.now() / 1000 - unixSec) / 86_400;
  if (days < 1) return 'today';
  if (days < 30) return `${Math.round(days)}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/**
 * The bundler rap sheet: the actual moat. For each known crew tied to this token,
 * list how many tokens it has launched, its rug rate, and its recent launches by
 * name. This is the cross-token memory no single-token scanner has.
 */
export function formatRapSheet(
  mint: string,
  fingerprint: CabalFingerprintResult,
): { text: string; replyMarkup: InlineKeyboard } {
  const matches = [...fingerprint.matches].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  const lines: string[] = [`🚩 <b>Bundler rap sheet</b>`, `<code>${esc(mint)}</code>`, ''];

  if (matches.length === 0) {
    lines.push('<i>No known crews matched.</i>');
  }

  matches.forEach((fp: CabalFingerprint, i: number) => {
    const tokens = [...fp.tokens].sort((a, b) => b.firstSeen - a.firstSeen);
    const rugged = tokens.filter((t) => t.rugLevel === 'red').length;
    const rugRate = tokens.length ? Math.round((rugged / tokens.length) * 100) : 0;
    const cat = fp.components.funderCategory && fp.components.funderCategory !== 'unknown'
      ? ` · ${esc(fp.components.funderCategory)}`
      : '';

    if (i > 0) lines.push('');
    lines.push(`<b>Crew ${esc(fp.id.slice(0, 6))}</b> · ${fp.confidence}% conf${cat}`);
    lines.push(leaf(T, 'Launches', `<b>${fp.totalAppearances}</b> tokens · last ${ago(fp.lastSeen)}`));
    lines.push(leaf(T, 'Rug rate', `<b>${rugRate}%</b> <i>(${rugged}/${tokens.length} went red)</i>`));
    lines.push(leaf(L, 'Wallets ', `<b>${fp.knownWallets.length}</b> known`));

    // Recent prior launches by name, the receipts.
    const recent = tokens.filter((t) => t.mint !== mint).slice(0, 4);
    if (recent.length) {
      lines.push('<i>Prior launches:</i>');
      for (const t of recent) {
        const label = t.tokenSymbol ? `$${esc(t.tokenSymbol)}` : `<code>${esc(truncateAddress(t.mint))}</code>`;
        lines.push(`  ${rugEmoji(t.rugLevel)} ${label} <i>${ago(t.firstSeen)}</i>`);
      }
    }
  });

  const replyMarkup: InlineKeyboard = [
    [{ text: '🫧 Open in Bubble Map ↗', url: `${APP_URL}/?mint=${mint}` }],
    [{ text: '🚫 Full blacklist ↗', url: `${APP_URL}/blacklist` }],
    ...FOOTER_ROW,
  ];
  return { text: lines.join('\n'), replyMarkup };
}
