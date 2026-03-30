import { NextRequest, NextResponse } from 'next/server';
import { getAllTokenHolders } from '@/lib/helius';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Poll current token holders — returns top holders with balances.
 * Client polls every 10s, diffs against previous state to detect changes.
 * getTokenAccounts is 10 credits, cached server-side.
 */
export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get('mint');
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);

  if (!mint) {
    return NextResponse.json({ error: 'mint required' }, { status: 400 });
  }

  try {
    const holders = await getAllTokenHolders(mint, 1);
    const topHolders = holders
      .filter(h => h.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit)
      .map(h => ({
        owner: h.owner,
        amount: h.amount,
      }));

    return NextResponse.json({
      holders: topHolders,
      totalHolders: holders.filter(h => h.amount > 0).length,
      timestamp: Date.now(),
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Poll error:', error);
    return NextResponse.json({ error: 'Failed to fetch holders' }, { status: 500 });
  }
}
