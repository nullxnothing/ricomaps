import { NextRequest, NextResponse } from 'next/server';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  getSnapshot,
  getTimeline,
  getSnapshotSummaries,
  isBackfillComplete,
  getBackfillProgress,
  backfillTokenHistory,
  isBackfillRunning,
} from '@/lib/snapshot-engine';

export const maxDuration = 30; // Vercel function timeout

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'token-history');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const mint = searchParams.get('mint');
  const timestampParam = searchParams.get('timestamp');

  if (!mint || !isValidSolanaAddress(mint)) {
    return NextResponse.json({ error: 'Invalid or missing mint address' }, { status: 400 });
  }

  // Mode: specific snapshot by timestamp
  if (timestampParam) {
    const timestamp = parseInt(timestampParam, 10);
    if (isNaN(timestamp) || timestamp <= 0) {
      return NextResponse.json({ error: 'Invalid timestamp parameter' }, { status: 400 });
    }

    const snapshot = getSnapshot(mint, timestamp);
    if (!snapshot) {
      return NextResponse.json({ error: 'No snapshot data available.' }, { status: 404 });
    }

    return NextResponse.json({ snapshot, nearestTimestamp: snapshot.blockTime });
  }

  // If backfill is not complete and not currently running, process a chunk NOW
  // This is the key for Vercel: each poll request does real work
  if (!isBackfillComplete(mint) && !isBackfillRunning(mint)) {
    try {
      await backfillTokenHistory(mint);
    } catch (err) {
      console.error(`[snapshot-engine] Chunk failed for ${mint}:`, err);
    }
  }

  // Return current state
  const timeline = getTimeline(mint);
  const snapshots = getSnapshotSummaries(mint);

  return NextResponse.json({
    timeline: timeline ?? null,
    snapshots: snapshots ?? [],
    snapshotCount: timeline?.timestamps.length ?? 0,
    isComplete: isBackfillComplete(mint),
    progress: getBackfillProgress(mint),
  });
}
