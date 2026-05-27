import { NextRequest, NextResponse } from 'next/server';
import { getTokenHoldersIncremental } from '@/lib/helius';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'poll');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const mint = request.nextUrl.searchParams.get('mint');
  const limitParam = parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(1, limitParam), 200);
  const sinceSlotParam = request.nextUrl.searchParams.get('sinceSlot');
  const sinceSlot = sinceSlotParam ? parseInt(sinceSlotParam, 10) : undefined;

  if (!mint || !isValidSolanaAddress(mint)) {
    return NextResponse.json({ error: 'Valid mint address required' }, { status: 400 });
  }

  try {
    // Incremental path: use getProgramAccountsV2 with changedSinceSlot (1 credit vs 10)
    if (sinceSlot !== undefined && !isNaN(sinceSlot)) {
      const { holders: incremental, lastSlot } = await getTokenHoldersIncremental(mint, sinceSlot);

      const changedHolders = incremental
        .sort((a, b) => b.balance - a.balance)
        .slice(0, limit)
        .map(h => ({
          owner: h.address,
          amount: h.balance,
        }));
      const removed = incremental
        .filter(h => h.balance <= 0)
        .map(h => h.address)
        .slice(0, limit);

      return NextResponse.json({
        holders: changedHolders,
        removed,
        totalHolders: incremental.filter(h => h.balance > 0).length,
        timestamp: Date.now(),
        lastSlot,
        isIncremental: true,
      }, {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }

    // Full fetch path (first poll or no sinceSlot)
    const { holders, lastSlot } = await getTokenHoldersIncremental(mint);
    const topHolders = holders
      .filter(h => h.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit)
      .map(h => ({
        owner: h.address,
        amount: h.balance,
      }));

    return NextResponse.json({
      holders: topHolders,
      totalHolders: holders.filter(h => h.balance > 0).length,
      timestamp: Date.now(),
      lastSlot,
      isIncremental: false,
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json({ error: 'Failed to fetch holders' }, { status: 500 });
  }
}
