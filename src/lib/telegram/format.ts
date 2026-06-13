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
export function formatTokenCard(
  mint: string,
  result: ScanResultLike,
): { text: string; replyMarkup: InlineKeyboard } {
  const { stats, tokenMetadata: meta, tokenSecurity: sec, deployerInfo: dep } = result;
  const sc = stats.supplyConcentration;
  const rug = stats.rugScore;

  const name = meta?.name ?? 'Unknown token';
  const symbol = meta?.symbol ? `$${meta.symbol}` : '';
  const scoreStr = rug ? `RUG SCORE ${rug.score}/100` : 'RUG SCORE —';

  const lines: string[] = [];

  // Header + CA
  lines.push(`${rugEmoji(rug?.level)} <b>${esc(name)}</b>${symbol ? ` (${esc(symbol)})` : ''} — ${scoreStr}`);
  lines.push(`<code>${esc(mint)}</code>`);

  // Top rug factors (what's driving the verdict)
  if (rug?.factors?.length) {
    const top = rug.factors.slice(0, 3).map((f) => esc(f.label)).join(' · ');
    if (top) lines.push(`<i>${top}</i>`);
  }

  // RicoMaps intelligence block — the differentiator
  lines.push('');
  lines.push('🔬 <b>RicoMaps Intel</b>');
  if (sc) {
    lines.push(`├ Insider hold   <b>${pct(sc.insiderStillHoldingPct)}</b>  <i>(bundlers+snipers not yet sold)</i>`);
    lines.push(`├ Cabal          <b>${pct(sc.cabalSupplyPct)}</b>  <i>shared-funder cluster</i>`);
    const bundleN = stats.bundledWallets?.length ?? 0;
    const clusterN = stats.bundleClustersDetected ?? 0;
    lines.push(`├ Bundled        <b>${pct(sc.bundledSupplyPct)}</b>  <i>${bundleN} wallets / ${clusterN} bundles</i>`);
    const sniperN = stats.sniperWallets?.length ?? stats.snipersDetected ?? 0;
    lines.push(`├ Snipers        <b>${pct(sc.sniperSupplyPct)}</b>  <i>${sniperN} wallets</i>`);
    lines.push(`├ Fresh wallets  <b>${pct(sc.freshWalletPct)}</b>`);
    lines.push(`├ Top 10         <b>${pct(sc.top10Pct)}</b>`);
  }
  // Deployer intel — the single biggest rug predictor
  if (dep) {
    const bits: string[] = [];
    if (dep.isSerialDeployer) {
      const n = dep.pastLaunchCount != null ? `${dep.pastLaunchCount} prior launches` : 'serial';
      bits.push(`⚠️ SERIAL — ${esc(n)}`);
    } else {
      bits.push('clean history');
    }
    if (dep.stillHolds === true && dep.heldSupplyPct != null) bits.push(`still holds ${pct(dep.heldSupplyPct)}`);
    else if (dep.stillHolds === false) bits.push('sold');
    lines.push(`└ Deployer       ${bits.join(' · ')}`);
  }

  // Cross-token bundler fingerprint — wallets seen on other launches (the blacklist)
  const fpMatches = stats.cabalFingerprint?.matches?.length ?? 0;
  if (fpMatches > 0) {
    lines.push('');
    lines.push(`🚩 <b>${fpMatches} known bundler${fpMatches === 1 ? '' : 's'}</b> here also seen on prior launches`);
  }

  // Market block — familiar territory, kept compact
  if (meta) {
    lines.push('');
    lines.push('💹 <b>Market</b>');
    const marketBits: string[] = [];
    if (meta.marketCap != null) marketBits.push(`MC ${formatMarketCap(meta.marketCap)}`);
    if (meta.volume24h != null) marketBits.push(`Vol ${formatUsd(meta.volume24h)}`);
    if (meta.liquidity != null) marketBits.push(`LP ${formatUsd(meta.liquidity)}`);
    if (marketBits.length) lines.push(`├ ${marketBits.join('  •  ')}`);
    if (meta.priceChange24h != null) {
      const arrow = meta.priceChange24h >= 0 ? '🟢' : '🔴';
      lines.push(`└ 24h ${arrow} ${meta.priceChange24h >= 0 ? '+' : ''}${meta.priceChange24h.toFixed(1)}%`);
    }
  }

  // Security
  if (sec) {
    const flags: string[] = [];
    flags.push(sec.hasMintAuthority ? 'Mint ❌' : 'Mint ✅');
    flags.push(sec.hasFreezeAuthority ? 'Freeze ❌' : 'Freeze ✅');
    flags.push(sec.isMutable ? 'Mutable ❌' : 'Immutable ✅');
    lines.push('');
    lines.push(`🔐 ${flags.join('  •  ')}`);
  }

  const text = lines.join('\n');

  // Inline keyboard — deep link to the live map replaces image generation.
  const dexUrl = meta?.dexUrl ?? `https://dexscreener.com/solana/${mint}`;
  const replyMarkup: InlineKeyboard = [
    [{ text: '🫧 Live Bubble Map ↗', url: `${APP_URL}/?mint=${mint}` }],
    [
      { text: '🔔 Watch', callback_data: `watch:${mint}` },
      { text: 'DexScreener', url: dexUrl },
      { text: 'Solscan', url: `https://solscan.io/token/${mint}` },
    ],
  ];

  return { text, replyMarkup };
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
