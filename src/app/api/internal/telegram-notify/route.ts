import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { getSubscribers } from '@/lib/telegram/subscriptions';
import { formatAlert, type AlertEvent, type AlertKind } from '@/lib/telegram/alert-format';
import { sendMessage } from '@/lib/telegram/client';

export const maxDuration = 30;

const VALID_KINDS: AlertKind[] = ['bundle-cluster', 'dev-sell', 'blacklist-buy', 'rug'];

interface NotifyBody {
  kind?: string;
  mint?: string;
  symbol?: string;
  wallet?: string;
  count?: number;
  estExtractedUsd?: number;
  supplyPct?: number;
}

/**
 * Worker → app alert funnel. The worker POSTs every alert-worthy event it detects
 * (bundle clusters, dev sells, blacklisted-bundler buys, rugs); this route filters
 * by who's actually subscribed to that mint and fans the message out via the bot.
 * Returns the number of chats notified.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: NotifyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { kind, mint } = body;
  if (!kind || !VALID_KINDS.includes(kind as AlertKind)) {
    return NextResponse.json({ success: false, error: 'Invalid kind' }, { status: 400 });
  }
  if (!mint || !isValidSolanaAddress(mint)) {
    return NextResponse.json({ success: false, error: 'Invalid mint' }, { status: 400 });
  }

  // Union of chats watching this mint and chats watching the acting wallet (dev/bundler).
  const [mintSubs, walletSubs] = await Promise.all([
    getSubscribers('mint', mint),
    body.wallet && isValidSolanaAddress(body.wallet) ? getSubscribers('wallet', body.wallet) : Promise.resolve([]),
  ]);
  const chatIds = [...new Set([...mintSubs, ...walletSubs])];
  if (chatIds.length === 0) {
    return NextResponse.json({ success: true, notified: 0 });
  }

  const event: AlertEvent = {
    kind: kind as AlertKind,
    mint,
    symbol: body.symbol,
    wallet: body.wallet,
    count: body.count,
    estExtractedUsd: body.estExtractedUsd,
    supplyPct: body.supplyPct,
  };
  const { text, replyMarkup } = formatAlert(event);

  // Fan out; Telegram allows ~30 msg/s, our subscriber counts are small. Failures
  // (blocked bot, deleted chat) are swallowed per-chat so one bad chat doesn't poison the batch.
  const results = await Promise.allSettled(
    chatIds.map((chatId) => sendMessage({ chatId, text, replyMarkup })),
  );
  const notified = results.filter((r) => r.status === 'fulfilled').length;

  return NextResponse.json({ success: true, notified });
}
