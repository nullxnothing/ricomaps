import 'server-only';

// Minimal Telegram Bot API client. We only use the handful of methods the bot
// needs (sendMessage, answerInlineQuery, answerCallbackQuery) plus setup helpers.
// The token never leaves the server; all calls go out from API routes / scripts.

const API_BASE = 'https://api.telegram.org';

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  return token;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<TelegramResponse<T>> {
  const res = await fetch(`${API_BASE}/bot${botToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  return (await res.json()) as TelegramResponse<T>;
}

interface SendMessageOptions {
  chatId: number | string;
  text: string;
  replyMarkup?: InlineKeyboard;
  replyToMessageId?: number;
  /** Telegram caps message text at 4096 chars; we trim defensively. */
  disablePreview?: boolean;
  /** Render this URL's image as a small preview thumbnail above the message (the token logo). */
  previewUrl?: string;
}

function linkPreviewOptions(opts: SendMessageOptions): Record<string, unknown> {
  if (opts.previewUrl) {
    // Show the logo as a small preview thumbnail, anchored to a specific URL so
    // it doesn't depend on link order in the text.
    return { url: opts.previewUrl, prefer_small_media: true, show_above_text: true };
  }
  return { is_disabled: opts.disablePreview ?? true };
}

export async function sendMessage(opts: SendMessageOptions): Promise<void> {
  await call('sendMessage', {
    chat_id: opts.chatId,
    text: opts.text.slice(0, 4096),
    parse_mode: 'HTML',
    link_preview_options: linkPreviewOptions(opts),
    ...(opts.replyToMessageId ? { reply_to_message_id: opts.replyToMessageId } : {}),
    ...(opts.replyMarkup ? { reply_markup: { inline_keyboard: opts.replyMarkup } } : {}),
  });
}

interface SendPhotoOptions {
  chatId: number | string;
  photoUrl: string;
  caption: string;
  replyMarkup?: InlineKeyboard;
}

/**
 * Send a photo with an HTML caption. Telegram fetches the photo URL server-side,
 * so it handles dexscreener/IPFS-gateway https URLs. Captions cap at 1024 chars.
 * Returns false if Telegram rejected the photo (bad/unreachable image) so the
 * caller can fall back to a plain text card.
 */
export async function sendPhoto(opts: SendPhotoOptions): Promise<boolean> {
  const res = await call<unknown>('sendPhoto', {
    chat_id: opts.chatId,
    photo: opts.photoUrl,
    caption: opts.caption.slice(0, 1024),
    parse_mode: 'HTML',
    ...(opts.replyMarkup ? { reply_markup: { inline_keyboard: opts.replyMarkup } } : {}),
  });
  return res.ok;
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await call('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

interface EditCaptionOptions {
  chatId: number | string;
  messageId: number;
  caption: string;
  replyMarkup?: InlineKeyboard;
}

/** Edit a photo card's caption in place (used by the 🔄 Refresh button). */
export async function editMessageCaption(opts: EditCaptionOptions): Promise<boolean> {
  const res = await call<unknown>('editMessageCaption', {
    chat_id: opts.chatId,
    message_id: opts.messageId,
    caption: opts.caption.slice(0, 1024),
    parse_mode: 'HTML',
    ...(opts.replyMarkup ? { reply_markup: { inline_keyboard: opts.replyMarkup } } : {}),
  });
  return res.ok;
}

interface EditTextOptions {
  chatId: number | string;
  messageId: number;
  text: string;
  replyMarkup?: InlineKeyboard;
}

/** Edit a text card in place (refresh path when the card was sent as text). */
export async function editMessageText(opts: EditTextOptions): Promise<boolean> {
  const res = await call<unknown>('editMessageText', {
    chat_id: opts.chatId,
    message_id: opts.messageId,
    text: opts.text.slice(0, 4096),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(opts.replyMarkup ? { reply_markup: { inline_keyboard: opts.replyMarkup } } : {}),
  });
  return res.ok;
}

// --- Setup helpers (used by scripts, not the request path) ---

export async function getMe(): Promise<TelegramResponse<{ id: number; username: string; first_name: string }>> {
  return call('getMe', {});
}

export async function setWebhook(url: string, secretToken: string): Promise<TelegramResponse<boolean>> {
  return call('setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'callback_query', 'inline_query'],
  });
}

export async function deleteWebhook(): Promise<TelegramResponse<boolean>> {
  return call('deleteWebhook', {});
}
