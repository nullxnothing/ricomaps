import { NextRequest, NextResponse } from 'next/server';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  backfillTokenHistory,
  isBackfillComplete,
  isBackfillRunning,
  getBackfillProgress,
} from '@/lib/snapshot-engine';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'token-history');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  let body: { mint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mint } = body;
  if (!mint || !isValidSolanaAddress(mint)) {
    return NextResponse.json({ error: 'Invalid or missing mint address' }, { status: 400 });
  }

  if (isBackfillComplete(mint)) {
    return NextResponse.json({ started: false, alreadyComplete: true, progress: 100 });
  }

  if (isBackfillRunning(mint)) {
    return NextResponse.json({ started: false, alreadyRunning: true, progress: getBackfillProgress(mint) });
  }

  // Process first chunk synchronously — don't fire-and-forget on Vercel
  try {
    await backfillTokenHistory(mint);
  } catch (err) {
    console.error(`[snapshot-engine] Start chunk failed for ${mint}:`, err);
  }

  return NextResponse.json({
    started: true,
    progress: getBackfillProgress(mint),
    isComplete: isBackfillComplete(mint),
  });
}
