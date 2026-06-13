import 'server-only';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { getCachedTokenScan } from '@/lib/db-cache';
import { sendMessage, sendPhoto, answerCallbackQuery, type InlineKeyboard } from './client';
import { formatTokenCard, FOOTER_ROW, type ScanResultLike } from './format';
import { addSubscription, removeSubscription, listSubscriptions } from './subscriptions';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ricomaps.fun').replace(/\/$/, '');

// Base58 token-length run, used to spot a CA anywhere inside a group message.
const CA_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// --- Minimal subset of the Telegram update shape we consume ---
interface TgChat { id: number; type: string }
interface TgMessage { message_id: number; chat: TgChat; text?: string }
interface TgCallbackQuery { id: string; data?: string; message?: TgMessage }
export interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  inline_query?: { id: string; query: string };
}

// Bot username drives the "Add to Group" deep link. Override per-bot via env.
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? 'RicoMaps_bot';

// Logo shown atop /start. Telegram fetches it server-side from this URL.
const LOGO_URL = `${APP_URL}/ricomapspfp.png`;

const HELP = [
  '🎯 <b>RicoMaps</b> · Solana forensic intel.',
  '',
  '<b>Send a contract address</b> and get an instant forensic card:',
  '├ rug score · insider/cabal/bundle/sniper supply',
  '├ deployer history · known-bundler blacklist hits',
  '└ market · security · live bubble map',
  '',
  '<b>Commands</b>',
  '├ <code>/scan &lt;CA&gt;</code> · scan a token',
  '└ <code>/watchlist</code> · your watched mints',
  '',
  '🔔 Tap <b>Watch</b> on any card for live alerts: bundle clusters, dev sells, blacklisted-bundler buys, and rugs.',
  '👥 In groups, just paste a CA. No command needed.',
].join('\n');

/** Help-message keyboard: add-to-group + open the app. */
const HELP_MARKUP: InlineKeyboard = [
  [{ text: '➕ Add to Group', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }],
  [{ text: '🌐 Open RicoMaps ↗', url: APP_URL }],
  ...FOOTER_ROW,
];

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

/**
 * Find the first valid Solana mint in a message. Handles "/scan ADDR",
 * a bare address, or a CA embedded anywhere in a sentence (group chats).
 */
function extractMint(text: string): string | null {
  const cmd = text.trim().match(/^\/scan(?:@\w+)?\s+(\S+)/i);
  if (cmd && isValidSolanaAddress(cmd[1])) return cmd[1];
  for (const candidate of text.match(CA_RE) ?? []) {
    if (isValidSolanaAddress(candidate)) return candidate;
  }
  return null;
}

async function handleScan(chatId: number, mint: string, replyTo: number): Promise<void> {
  await sendMessage({ chatId, text: '🔍 Scanning…', replyToMessageId: replyTo });
  try {
    const result = await runScan(mint);
    const { text, replyMarkup, photoUrl } = formatTokenCard(mint, result);
    // Lead with the token logo when we have one; fall back to text if Telegram
    // can't fetch the image (bad/unreachable URL → sendPhoto returns false).
    if (photoUrl) {
      const ok = await sendPhoto({ chatId, photoUrl, caption: text, replyMarkup });
      if (ok) return;
    }
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
      ok ? '🔔 Watching. I\'ll alert you on bundles, dev sells, blacklisted buys, and rugs.'
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

/** Top-level dispatcher. Always resolves; the webhook returns 200 regardless. */
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
    const sent = await sendPhoto({ chatId, photoUrl: LOGO_URL, caption: HELP, replyMarkup: HELP_MARKUP });
    if (!sent) await sendMessage({ chatId, text: HELP, replyMarkup: HELP_MARKUP });
    return;
  }

  if (/^\/watchlist\b/i.test(text)) {
    await handleWatchlist(chatId);
    return;
  }

  // Ignore other slash-commands (e.g. /something@OtherBot) so we don't reply to noise.
  const isScanCmd = /^\/scan\b/i.test(text);
  if (text.startsWith('/') && !isScanCmd) return;

  // Scan when: explicit /scan, a DM (any message), or a group message that
  // contains a CA anywhere in the text (auto-detect, no /scan needed).
  const mint = extractMint(text);
  if (mint) {
    await handleScan(chatId, mint, msg.message_id);
  } else if (isScanCmd) {
    await sendMessage({ chatId, text: 'Usage: <code>/scan &lt;contract address&gt;</code>' });
  }
}
