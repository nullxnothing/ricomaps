import 'server-only';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { isTokenMint } from '@/lib/helius';
import { scanTokenForensics } from '@/lib/scan-core';
import { fetchTokenMarketData } from '@/lib/dexscreener';
import { getWalletBalances } from '@/lib/helius';
import { walletRealizedSol } from '@/lib/wallet-pnl';
import { formatUsd, formatMarketCap } from '@/lib/format';
import { sendMessage, sendPhoto, answerCallbackQuery, editMessageCaption, editMessageText, type InlineKeyboard } from './client';
import { formatTokenCard, formatRapSheet, FOOTER_ROW, type ScanResultLike } from './format';
import { addSubscription, removeSubscription, listSubscriptions } from './subscriptions';
import { recordCall, buildLeaderboard, type LeaderboardWindow } from './group-calls';
import { inspectMessage } from './scam-guard';
import { getXIdentityByUsername, trackHandles, normalizeHandle } from '@/lib/x-account-history';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ricomaps.fun').replace(/\/$/, '');

// Base58 token-length run, used to spot a CA anywhere inside a group message.
const CA_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// --- Minimal subset of the Telegram update shape we consume ---
interface TgChat { id: number; type: string }
interface TgUser { id: number; username?: string; first_name?: string }
interface TgMessage { message_id: number; chat: TgChat; from?: TgUser; text?: string; photo?: unknown[] }
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
  '├ <code>/scan &lt;CA&gt;</code> · full forensic scan',
  '├ <code>/price &lt;CA&gt;</code> · quick market snapshot',
  '├ <code>/pnl &lt;wallet&gt;</code> · wallet SOL PnL + bags',
  '├ <code>/top [24h|7d|30d]</code> · group caller leaderboard',
  '├ <code>/x &lt;handle&gt;</code> · recycled X-account check',
  '├ <code>/watch &lt;wallet&gt;</code> · track a cabal wallet',
  '└ <code>/watchlist</code> · what you\'re watching',
  '',
  '🔔 Tap <b>Watch</b> on any card for live alerts: bundle clusters, dev sells, blacklisted-bundler buys, and rugs.',
  '🚩 Tap <b>Bundler rap sheet</b> to see a crew\'s prior launches and rug rate.',
  '👥 In groups, just paste a CA — it scans AND logs your call for the leaderboard.',
  '🛡 Drainer links and flagged scam wallets are auto-warned in groups.',
].join('\n');

/** Help-message keyboard: add-to-group + open the app. */
const HELP_MARKUP: InlineKeyboard = [
  [{ text: '➕ Add to Group', url: `https://t.me/${BOT_USERNAME}?startgroup=true` }],
  [{ text: '🌐 Open RicoMaps ↗', url: APP_URL }],
  ...FOOTER_ROW,
];

/** Cache-first scan with the lightweight quick-scan parameters. `force` skips the cache (Refresh). */
function runScan(mint: string, force = false): Promise<ScanResultLike> {
  return scanTokenForensics(mint, { force });
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

/**
 * Scan a token CA and reply with the card. `quiet` (group auto-detect) skips any
 * reply when the address isn't a token, so a wallet pasted in a group is ignored
 * instead of generating noise. In DMs / explicit /scan we tell the user.
 */
async function handleScan(chatId: number, mint: string, replyTo: number, quiet = false): Promise<void> {
  // Only scan token CAs, never wallets. DAS interface check (same gate /api/scan uses).
  if (!(await isTokenMint(mint))) {
    if (!quiet) await sendMessage({ chatId, text: 'That looks like a wallet, not a token. Send a token contract address (CA).' });
    return;
  }
  await sendMessage({ chatId, text: '🔍 Scanning…', replyToMessageId: replyTo });
  try {
    const result = await runScan(mint);
    const { text, replyMarkup, previewUrl } = formatTokenCard(mint, result);
    // One text card (4096-char cap) with everything inline; the logo rides as a
    // small link preview above the text.
    await sendMessage({ chatId, text, replyMarkup, previewUrl });
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

  // 🔄 Refresh: re-scan (cache-bypass) and edit the card in place.
  const refresh = data.match(/^refresh:(\S+)$/);
  if (refresh && chatId != null && cb.message) {
    const mint = refresh[1];
    if (!isValidSolanaAddress(mint)) {
      await answerCallbackQuery(cb.id, '⚠️ Invalid address.');
      return;
    }
    await answerCallbackQuery(cb.id, '🔄 Refreshing…');
    try {
      const result = await runScan(mint, true);
      const { text, replyMarkup } = formatTokenCard(mint, result);
      const messageId = cb.message.message_id;
      const isPhoto = Array.isArray(cb.message.photo);
      // ok:false here usually means "message is not modified" (no change); harmless.
      if (isPhoto) await editMessageCaption({ chatId, messageId, caption: text, replyMarkup });
      else await editMessageText({ chatId, messageId, text, replyMarkup });
    } catch (err) {
      console.error('[telegram] refresh failed', mint, err);
    }
    return;
  }

  // 🚩 Bundler rap sheet: pull the matched crews' cross-token history (cache-first).
  const rap = data.match(/^rap:(\S+)$/);
  if (rap && chatId != null) {
    await answerCallbackQuery(cb.id, '🚩 Pulling rap sheet…');
    const mint = rap[1];
    if (!isValidSolanaAddress(mint)) return;
    try {
      const result = await runScan(mint);
      const fp = result.stats.cabalFingerprint;
      if (!fp || fp.matches.length === 0) {
        await sendMessage({ chatId, text: '✅ No known bundler crews matched this token.' });
        return;
      }
      const { text, replyMarkup } = formatRapSheet(mint, fp);
      await sendMessage({ chatId, text, replyMarkup });
    } catch (err) {
      console.error('[telegram] rap sheet failed', mint, err);
      await sendMessage({ chatId, text: '⚠️ Could not load the rap sheet. Try re-scanning first.' });
    }
    return;
  }

  await answerCallbackQuery(cb.id);
}

/** Render a chat's current watchlist (tokens + wallets). */
async function handleWatchlist(chatId: number): Promise<void> {
  const subs = await listSubscriptions(chatId);
  const mints = subs.filter((s) => s.kind === 'mint');
  const wallets = subs.filter((s) => s.kind === 'wallet');
  if (subs.length === 0) {
    await sendMessage({
      chatId,
      text: 'Nothing watched yet.\n\nTap <b>🔔 Watch</b> on a scan card to watch a token, or <code>/watch &lt;wallet&gt;</code> to track a cabal wallet.',
    });
    return;
  }
  const lines: string[] = ['🔔 <b>Your watchlist</b>'];
  if (mints.length) {
    lines.push('', '<b>Tokens</b>');
    for (const s of mints) lines.push(`🪙 <code>${s.target}</code>`);
  }
  if (wallets.length) {
    lines.push('', '<b>Wallets</b>');
    for (const s of wallets) lines.push(`👛 <code>${s.target}</code>`);
  }
  lines.push('', 'Stop with <code>/unwatch &lt;address&gt;</code>.');
  await sendMessage({ chatId, text: lines.join('\n') });
}

/** /watch &lt;wallet&gt; — track a cabal/deployer wallet for live activity. */
async function handleWatchWallet(chatId: number, text: string): Promise<void> {
  const addr = (text.match(CA_RE) ?? []).find(isValidSolanaAddress);
  if (!addr) {
    await sendMessage({ chatId, text: 'Usage: <code>/watch &lt;wallet address&gt;</code>\nAlerts you when that wallet buys or funds a launch we see.' });
    return;
  }
  const ok = await addSubscription(chatId, 'wallet', addr);
  await sendMessage({
    chatId,
    text: ok
      ? `👛 Watching wallet <code>${addr}</code>.\nI'll ping you when it shows up buying or funding a tracked launch.`
      : '⚠️ Watchlist full. <code>/unwatch</code> something first.',
  });
}

/** /unwatch &lt;address&gt; — remove a token or wallet from the watchlist. */
async function handleUnwatchCmd(chatId: number, text: string): Promise<void> {
  const addr = (text.match(CA_RE) ?? []).find(isValidSolanaAddress);
  if (!addr) {
    await sendMessage({ chatId, text: 'Usage: <code>/unwatch &lt;address&gt;</code>' });
    return;
  }
  // Remove from both kinds; harmless no-op on the kind that wasn't subscribed.
  await removeSubscription(chatId, 'mint', addr);
  await removeSubscription(chatId, 'wallet', addr);
  await sendMessage({ chatId, text: `🔕 Unwatched <code>${addr}</code>.` });
}

/** Best-effort display handle for a caller: @username, else first name, else "anon". */
function displayName(user: TgUser | undefined): string {
  if (!user) return 'anon';
  if (user.username) return `@${user.username}`;
  return user.first_name ?? `id${user.id}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** /price <CA> — quick market snapshot (no full forensic scan). */
async function handlePrice(chatId: number, text: string): Promise<void> {
  const mint = extractMint(text);
  if (!mint) {
    await sendMessage({ chatId, text: 'Usage: <code>/price &lt;contract address&gt;</code>' });
    return;
  }
  const m = await fetchTokenMarketData(mint);
  if (!m || (m.priceUsd == null && m.marketCap == null)) {
    await sendMessage({ chatId, text: '⚠️ No market data found for that token yet.' });
    return;
  }
  const sym = m.symbol ? `$${escHtml(m.symbol)}` : escHtml(m.name ?? 'Token');
  const lines = [`💱 <b>${sym}</b>`];
  if (m.priceUsd != null) lines.push(`├ <code>Price</code> $${m.priceUsd < 0.01 ? m.priceUsd.toPrecision(2) : m.priceUsd.toFixed(4)}`);
  if (m.marketCap != null) lines.push(`├ <code>MC   </code> ${formatMarketCap(m.marketCap)}`);
  if (m.volume24h != null) lines.push(`├ <code>Vol  </code> ${formatUsd(m.volume24h)}`);
  if (m.liquidity != null) lines.push(`├ <code>LP   </code> ${formatUsd(m.liquidity)}`);
  if (m.priceChange24h != null) lines.push(`└ <code>24h  </code> ${m.priceChange24h >= 0 ? '+' : ''}${m.priceChange24h.toFixed(0)}% ${m.priceChange24h >= 0 ? '🟢' : '🔴'}`);
  await sendMessage({
    chatId,
    text: lines.join('\n'),
    replyMarkup: [[{ text: '🔬 Full forensic scan', callback_data: `refresh:${mint}` }, { text: '🫧 Bubble Map ↗', url: `${APP_URL}/?mint=${mint}` }]],
  });
}

/** /pnl <wallet> — SOL-flow PnL + portfolio snapshot for one wallet. */
async function handlePnl(chatId: number, text: string): Promise<void> {
  const addr = (text.match(CA_RE) ?? []).find(isValidSolanaAddress);
  if (!addr) {
    await sendMessage({ chatId, text: 'Usage: <code>/pnl &lt;wallet address&gt;</code>\nShows net SOL extracted + current portfolio.' });
    return;
  }
  const [realizedSol, balances] = await Promise.all([
    walletRealizedSol(addr).catch(() => 0),
    getWalletBalances(addr).catch(() => null),
  ]);
  const verdict = realizedSol >= 1 ? '🟢 net extractor (winner)' : realizedSol <= -2 ? '🔴 net spender (underwater)' : '⚪️ flat';
  const lines = [
    `💰 <b>Wallet PnL</b>`,
    `<code>${escHtml(addr)}</code>`,
    '',
    `├ <code>Realized</code> <b>${realizedSol >= 0 ? '+' : ''}${realizedSol.toFixed(2)} SOL</b> <i>(last 100 transfers)</i>`,
    `├ <code>Verdict </code> ${verdict}`,
    `└ <code>Bags    </code> ${balances ? formatUsd(balances.totalUsdValue) : 'n/a'}`,
    '',
    '<i>SOL-flow proxy: SOL pulled out minus SOL put in. Not mark-to-market.</i>',
  ];
  await sendMessage({
    chatId,
    text: lines.join('\n'),
    replyMarkup: [[{ text: '🕸 Trace funders ↗', url: `${APP_URL}/?address=${addr}` }]],
  });
}

/** /top [24h|7d|30d|all] — group caller leaderboard ranked by call performance. */
async function handleLeaderboard(chatId: number, text: string): Promise<void> {
  const arg = text.trim().split(/\s+/)[1]?.toLowerCase();
  const window: LeaderboardWindow = arg === '24h' || arg === '7d' || arg === '30d' ? arg : 'all';
  const entries = await buildLeaderboard(chatId, window);
  if (entries.length === 0) {
    await sendMessage({
      chatId,
      text: '📊 No calls tracked yet.\n\nPaste a token CA in this group and it gets logged as your call. Performance is scored from market cap at call vs now.',
    });
    return;
  }
  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`);
  const lines = [`🏆 <b>Caller Leaderboard</b> <i>(${window})</i>`, ''];
  entries.slice(0, 10).forEach((e, i) => {
    const best = e.bestMultiple >= 1 ? `${e.bestMultiple.toFixed(1)}x best` : 'no priced calls';
    lines.push(`${medal(i)} <b>${escHtml(e.username)}</b> — ${best} · ${e.calls} call${e.calls === 1 ? '' : 's'} · ${e.hitRate.toFixed(0)}% hit`);
  });
  lines.push('', '<i>Ranked by best single call (MC now ÷ MC at call). Hit = reached 2x+.</i>');
  await sendMessage({ chatId, text: lines.join('\n') });
}

/** /x <handle> — recycled-account check for an X handle. */
async function handleXAccount(chatId: number, text: string): Promise<void> {
  const raw = text.trim().split(/\s+/)[1];
  const handle = normalizeHandle(raw);
  if (!handle) {
    await sendMessage({ chatId, text: 'Usage: <code>/x &lt;handle&gt;</code>\nChecks whether an X account has been recycled (renamed / reused).' });
    return;
  }
  const identity = await getXIdentityByUsername(handle);
  if (!identity) {
    await trackHandles([handle]);
    await sendMessage({ chatId, text: `🆕 <b>@${escHtml(handle)}</b> isn't in the tracker yet. Now queued — check back in a day.` });
    return;
  }
  const lines = [`♻️ <b>X account: @${escHtml(identity.currentUsername)}</b>`];
  if (identity.isRecycled) {
    const prior = identity.priorUsernames.map((u) => `@${escHtml(u)}`).join(', ');
    lines.push(`├ <code>Recycled</code> 🔴 <b>yes</b> — was ${prior}`);
  } else {
    lines.push(`├ <code>Recycled</code> 🟢 no rename seen since tracking`);
  }
  if (identity.followers != null) lines.push(`├ <code>Followers</code> ${identity.followers.toLocaleString()}`);
  if (identity.linkedMints.length) lines.push(`├ <code>Tokens   </code> ${identity.linkedMints.length} linked CA${identity.linkedMints.length === 1 ? '' : 's'}`);
  lines.push(`└ <code>Tracked  </code> since ${new Date(identity.firstSeen * 1000).toISOString().slice(0, 10)}`);
  await sendMessage({ chatId, text: lines.join('\n') });
}

/** Record a group call + run the scam guard on a group message. Both best-effort. */
async function handleGroupMessage(msg: TgMessage, mint: string | null): Promise<void> {
  const chatId = msg.chat.id;
  // Scam guard (warn-only): flag drainer links / known scam wallets pasted in groups.
  const finding = inspectMessage(msg.text ?? '');
  if (finding) {
    await sendMessage({
      chatId,
      text: `⚠️ <b>Heads up:</b> a message above ${finding.reason}.\n<code>${escHtml(finding.evidence)}</code>\n<i>Do not connect your wallet or sign anything. RicoMaps auto-flagged this.</i>`,
      replyToMessageId: msg.message_id,
    });
  }
  // Call-tracking: first poster of a CA in this group is credited.
  if (mint && msg.from) {
    const market = await fetchTokenMarketData(mint).catch(() => null);
    await recordCall({
      chatId,
      userId: msg.from.id,
      username: displayName(msg.from),
      mint,
      marketCapAtCall: market?.marketCap ?? 0,
    });
  }
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
    // /start <CA> deep link: scan immediately so "Scan on RicoMaps" links land on the card.
    const startMint = text.match(/^\/start(?:@\w+)?\s+(\S+)/i)?.[1];
    if (startMint && isValidSolanaAddress(startMint)) {
      await handleScan(chatId, startMint, msg.message_id);
      return;
    }
    const sent = await sendPhoto({ chatId, photoUrl: LOGO_URL, caption: HELP, replyMarkup: HELP_MARKUP });
    if (!sent) await sendMessage({ chatId, text: HELP, replyMarkup: HELP_MARKUP });
    return;
  }

  if (/^\/watchlist\b/i.test(text)) {
    await handleWatchlist(chatId);
    return;
  }
  if (/^\/watch\b/i.test(text)) {
    await handleWatchWallet(chatId, text);
    return;
  }
  if (/^\/unwatch\b/i.test(text)) {
    await handleUnwatchCmd(chatId, text);
    return;
  }
  if (/^\/price\b/i.test(text)) {
    await handlePrice(chatId, text);
    return;
  }
  if (/^\/pnl\b/i.test(text)) {
    await handlePnl(chatId, text);
    return;
  }
  // /top and /leaderboard both open the caller leaderboard.
  if (/^\/(top|leaderboard|lb)\b/i.test(text)) {
    await handleLeaderboard(chatId, text);
    return;
  }
  if (/^\/x\b/i.test(text)) {
    await handleXAccount(chatId, text);
    return;
  }

  // Ignore other slash-commands (e.g. /something@OtherBot) so we don't reply to noise.
  const isScanCmd = /^\/scan\b/i.test(text);
  if (text.startsWith('/') && !isScanCmd) return;

  // Scan when: explicit /scan, a DM (any message), or a group message that
  // contains a CA anywhere in the text (auto-detect, no /scan needed).
  // Group auto-detect (not /scan) is quiet: a wallet pasted in a group is skipped
  // silently instead of replying "that's a wallet".
  const mint = extractMint(text);
  const isPrivate = msg.chat.type === 'private';
  const quiet = !isPrivate && !isScanCmd;

  // In groups: log the call + run the scam guard before/alongside the scan. The
  // call is credited to the poster even when the scan is quiet (e.g. cached).
  if (!isPrivate) {
    await handleGroupMessage(msg, mint);
  }

  if (mint) {
    await handleScan(chatId, mint, msg.message_id, quiet);
  } else if (isScanCmd) {
    await sendMessage({ chatId, text: 'Usage: <code>/scan &lt;contract address&gt;</code>' });
  }
}
