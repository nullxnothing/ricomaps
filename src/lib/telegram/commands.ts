import 'server-only';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { getCachedTokenScan } from '@/lib/db-cache';
import { sendMessage, answerCallbackQuery } from './client';
import { formatTokenCard, type ScanResultLike } from './format';

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
  '',
  'Tap <b>🫧 Live Bubble Map</b> on any card to open the interactive graph.',
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

/** Top-level dispatcher. Always resolves — the webhook returns 200 regardless. */
export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    const cb = update.callback_query;
    // 🔔 Watch — alerts land in Phase 2; acknowledge for now.
    if (cb.data?.startsWith('watch:')) {
      await answerCallbackQuery(cb.id, '🔔 Alerts are coming soon — watchlists land in the next update.');
    } else {
      await answerCallbackQuery(cb.id);
    }
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
