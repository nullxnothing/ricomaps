import 'server-only';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { getCachedTokenScan } from '@/lib/db-cache';
import { sendMessage, answerCallbackQuery } from './client';
import { formatTokenCard, type ScanResultLike } from './format';
import { addSubscription, removeSubscription, listSubscriptions } from './subscriptions';

// --- Minimal subset of the Telegram update shape we consume ---
interface TgChat { id: number; type: string }
interface TgMessage { message_id: number; chat: TgChat; text?: string }
interface TgCallbackQuery { id: string; data?: string; message?: TgMessage }
export interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  inline_query?: { id: string; query: string };
}

const HELP = [
  '🫧 <b>RicoMaps Bot</b> — Solana forensic intel.',
  '',
  'Send a token contract address, or use:',
  '<code>/scan &lt;CA&gt;</code> — full forensic card (rug score, insiders, cabal, bundles, deployer)',
  '<code>/watchlist</code> — show the mints you\'re watching for live alerts',
  '',
  'Tap <b>🫧 Live Bubble Map</b> on any card to open the interactive graph, or <b>🔔 Watch</b> to get alerts on bundle clusters, dev sells, blacklisted-bundler buys, and rugs.',
].join('\n');

/** Cache-first scan with the lightweight quick-scan parameters. */
async function runScan(mint: string): Promise<ScanResultLike> {
  const cached = await getCachedTokenScan(mint);
  if (cached) {
    return {
      stats: cached.stats as ScanResultLike['stats'],
      tokenSecurity: cached.tokenSecurity,
      tokenMetadata: cached.tokenMetadata,
      deployerInfo: cached.deployerInfo,
    };
  }
  const result = await mapTokenHolders(mint, { topN: 15, fundersPerHolder: 1 });
  return {
    stats: result.stats,
    tokenSecurity: result.tokenSecurity,
    tokenMetadata: result.tokenMetadata,
    deployerInfo: result.deployerInfo,
  };
}

/** Pull a candidate mint from a /scan command or a bare address message. */
function extractMint(text: string): string | null {
  const trimmed = text.trim();
  // "/scan ADDR" or "/scan@Bot ADDR"
  const cmd = trimmed.match(/^\/scan(?:@\w+)?\s+(\S+)/i);
  const candidate = cmd ? cmd[1] : trimmed;
  return isValidSolanaAddress(candidate) ? candidate : null;
}

async function handleScan(chatId: number, mint: string, replyTo: number): Promise<void> {
  await sendMessage({ chatId, text: '🔍 Scanning…', replyToMessageId: replyTo });
  try {
    const result = await runScan(mint);
    const { text, replyMarkup } = formatTokenCard(mint, result);
    await sendMessage({ chatId, text, replyMarkup });
  } catch (err) {
    console.error('[telegram] scan failed', mint, err);
    await sendMessage({ chatId, text: '⚠️ Scan failed. Double-check the contract address and try again.' });
  }
}

/** 🔔 Watch / 🔕 Unwatch inline-button callbacks. */
async function handleCallback(cb: TgCallbackQuery): Promise<void> {
  const data = cb.data ?? '';
  const chatId = cb.message?.chat.id;

  const watch = data.match(/^watch:(\S+)$/);
  if (watch && chatId != null) {
    const mint = watch[1];
    if (!isValidSolanaAddress(mint)) {
      await answerCallbackQuery(cb.id, '⚠️ Invalid address.');
      return;
    }
    const ok = await addSubscription(chatId, 'mint', mint);
    await answerCallbackQuery(
      cb.id,
      ok ? '🔔 Watching — I\'ll alert you on bundles, dev sells, blacklisted buys, and rugs.'
         : '⚠️ Watchlist full. Unwatch something first.',
    );
    return;
  }

  const unwatch = data.match(/^unwatch:(\S+)$/);
  if (unwatch && chatId != null) {
    await removeSubscription(chatId, 'mint', unwatch[1]);
    await answerCallbackQuery(cb.id, '🔕 Unwatched. No more alerts for this token.');
    return;
  }

  await answerCallbackQuery(cb.id);
}

/** Render a chat's current watchlist. */
async function handleWatchlist(chatId: number): Promise<void> {
  const subs = await listSubscriptions(chatId);
  const mints = subs.filter((s) => s.kind === 'mint');
  if (mints.length === 0) {
    await sendMessage({ chatId, text: 'No tokens watched yet. Tap <b>🔔 Watch</b> on any scan card to get live alerts.' });
    return;
  }
  const lines = ['🔔 <b>Your watchlist</b>', ''];
  for (const s of mints) lines.push(`• <code>${s.target}</code>`);
  lines.push('', 'Tap <b>🔕 Unwatch</b> on an alert to stop, or re-scan a token to manage it.');
  await sendMessage({ chatId, text: lines.join('\n') });
}

/** Top-level dispatcher. Always resolves — the webhook returns 200 regardless. */
export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;
  const text = msg.text.trim();
  const chatId = msg.chat.id;

  if (/^\/(start|help)\b/i.test(text)) {
    await sendMessage({ chatId, text: HELP });
    return;
  }

  if (/^\/watchlist\b/i.test(text)) {
    await handleWatchlist(chatId);
    return;
  }

  // In private chats we also accept a bare contract address (no /scan needed).
  const isPrivate = msg.chat.type === 'private';
  if (/^\/scan\b/i.test(text) || isPrivate) {
    const mint = extractMint(text);
    if (mint) {
      await handleScan(chatId, mint, msg.message_id);
    } else if (/^\/scan\b/i.test(text)) {
      await sendMessage({ chatId, text: 'Usage: <code>/scan &lt;contract address&gt;</code>' });
    }
  }
}
