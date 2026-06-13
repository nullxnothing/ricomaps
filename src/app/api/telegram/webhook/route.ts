import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { handleUpdate, type TgUpdate } from '@/lib/telegram/commands';

// Quick-scan params keep most requests well under this; cache hits are instant.
export const maxDuration = 30;

/**
 * Telegram secret-token check. Telegram echoes the token we set via setWebhook
 * in this header on every call, so we can reject anything that isn't Telegram.
 * Constant-time compare; a missing secret fails closed.
 */
function isAuthentic(request: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const provided = request.headers.get('x-telegram-bot-api-secret-token');
  if (!secret || !provided) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!isAuthentic(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true }); // malformed: ack so Telegram won't retry
  }

  try {
    await handleUpdate(update);
  } catch (err) {
    console.error('[telegram] handler error', err);
  }

  // Always 200 so Telegram doesn't redeliver (which would re-run the scan).
  return NextResponse.json({ ok: true });
}
