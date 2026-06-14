import 'server-only';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { isTokenMint, getWalletBalances } from '@/lib/helius';
import { scanTokenForensics } from '@/lib/scan-core';
import { fetchTokenMarketData } from '@/lib/dexscreener';
import { walletRealizedSol } from '@/lib/wallet-pnl';
import { formatUsd, formatMarketCap } from '@/lib/format';
import { getXIdentityByUsername, trackHandles, normalizeHandle } from '@/lib/x-account-history';
import { sendFollowup } from './client';
import { formatDiscordCard } from './format';

// Discord slash-command handlers. Each runs AFTER the route has already deferred the
// reply (scans exceed Discord's 3s ACK window), and posts its result as a follow-up.

interface CommandOption { name: string; value?: string }
export interface DiscordCommandData {
  name: string;
  options?: CommandOption[];
}

function optValue(data: DiscordCommandData, name: string): string | undefined {
  return data.options?.find((o) => o.name === name)?.value;
}

/**
 * Run a slash command and post the result as a follow-up. Always resolves; any error
 * is reported back to the user rather than thrown, so the deferred reply never hangs.
 */
export async function runDiscordCommand(
  applicationId: string,
  interactionToken: string,
  data: DiscordCommandData,
): Promise<void> {
  try {
    const content = await dispatch(data);
    await sendFollowup(applicationId, interactionToken, content);
  } catch (err) {
    console.error('[discord] command error:', data.name, err);
    await sendFollowup(applicationId, interactionToken, '⚠️ Something went wrong. Try again.');
  }
}

async function dispatch(data: DiscordCommandData): Promise<string> {
  switch (data.name) {
    case 'scan':
      return scanCommand(optValue(data, 'address'));
    case 'price':
      return priceCommand(optValue(data, 'address'));
    case 'pnl':
      return pnlCommand(optValue(data, 'wallet'));
    case 'x':
      return xCommand(optValue(data, 'handle'));
    default:
      return 'Unknown command.';
  }
}

async function scanCommand(address: string | undefined): Promise<string> {
  if (!address || !isValidSolanaAddress(address)) return 'Provide a valid token contract address.';
  if (!(await isTokenMint(address))) return 'That looks like a wallet, not a token. Send a token CA.';
  const result = await scanTokenForensics(address);
  return formatDiscordCard(address, result);
}

async function priceCommand(address: string | undefined): Promise<string> {
  if (!address || !isValidSolanaAddress(address)) return 'Provide a valid token contract address.';
  const m = await fetchTokenMarketData(address);
  if (!m || (m.priceUsd == null && m.marketCap == null)) return '⚠️ No market data found for that token yet.';
  const sym = m.symbol ? `$${m.symbol}` : (m.name ?? 'Token');
  const bits: string[] = [];
  if (m.priceUsd != null) bits.push(`Price $${m.priceUsd < 0.01 ? m.priceUsd.toPrecision(2) : m.priceUsd.toFixed(4)}`);
  if (m.marketCap != null) bits.push(`MC ${formatMarketCap(m.marketCap)}`);
  if (m.volume24h != null) bits.push(`Vol ${formatUsd(m.volume24h)}`);
  if (m.liquidity != null) bits.push(`LP ${formatUsd(m.liquidity)}`);
  if (m.priceChange24h != null) bits.push(`24h ${m.priceChange24h >= 0 ? '+' : ''}${m.priceChange24h.toFixed(0)}%`);
  return `💱 **${sym}**\n${bits.join(' · ')}`;
}

async function pnlCommand(wallet: string | undefined): Promise<string> {
  if (!wallet || !isValidSolanaAddress(wallet)) return 'Provide a valid wallet address.';
  const [realizedSol, balances] = await Promise.all([
    walletRealizedSol(wallet).catch(() => 0),
    getWalletBalances(wallet).catch(() => null),
  ]);
  const verdict = realizedSol >= 1 ? '🟢 net extractor (winner)' : realizedSol <= -2 ? '🔴 net spender (underwater)' : '⚪️ flat';
  return [
    `💰 **Wallet PnL** \`${wallet}\``,
    `Realized **${realizedSol >= 0 ? '+' : ''}${realizedSol.toFixed(2)} SOL** (last 100 transfers)`,
    `Verdict ${verdict} · Bags ${balances ? formatUsd(balances.totalUsdValue) : 'n/a'}`,
  ].join('\n');
}

async function xCommand(handleRaw: string | undefined): Promise<string> {
  const handle = normalizeHandle(handleRaw);
  if (!handle) return 'Usage: `/x <handle>` — checks whether an X account has been recycled.';
  const identity = await getXIdentityByUsername(handle);
  if (!identity) {
    await trackHandles([handle]);
    return `🆕 **@${handle}** isn't in the tracker yet. Now queued — check back in a day.`;
  }
  if (identity.isRecycled) {
    const prior = identity.priorUsernames.map((u) => `@${u}`).join(', ');
    return `♻️ **@${identity.currentUsername}** is a **recycled account** — previously ${prior}.`;
  }
  return `🟢 **@${identity.currentUsername}** — no rename seen since tracking began.`;
}
