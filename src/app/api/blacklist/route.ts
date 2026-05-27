import { NextRequest, NextResponse } from 'next/server';
import { getBundleClusters, getClustersByWallet } from '@/lib/db-blacklist';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { BlacklistResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'blacklist');
  if (!allowed) {
    return NextResponse.json<BlacklistResponse>(
      { success: false, clusters: [], totalWallets: 0, totalClusters: 0, page: 1, totalPages: 0, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const sortBy = (searchParams.get('sort') || 'confidence') as 'confidence' | 'last_seen' | 'total_appearances' | 'wallet_count';
    const minConfidence = parseInt(searchParams.get('minConfidence') || '0');
    const walletSearch = searchParams.get('wallet') || undefined;

    const { clusters, total } = await getBundleClusters({
      limit,
      offset: (page - 1) * limit,
      sortBy,
      sortDir: 'desc',
      minConfidence,
      walletSearch,
    });

    return NextResponse.json<BlacklistResponse>({
      success: true,
      clusters,
      totalWallets: clusters.reduce((sum, c) => sum + c.wallets.length, 0),
      totalClusters: total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('[Blacklist API] GET error:', error);
    return NextResponse.json<BlacklistResponse>(
      { success: false, clusters: [], totalWallets: 0, totalClusters: 0, page: 1, totalPages: 0, error: 'Failed to fetch blacklist' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'blacklist');
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const { wallets } = body;

    if (!Array.isArray(wallets) || wallets.length === 0) {
      return NextResponse.json({ success: false, error: 'wallets array required' }, { status: 400 });
    }

    const validWallets = wallets
      .filter((wallet: unknown): wallet is string => typeof wallet === 'string' && isValidSolanaAddress(wallet))
      .slice(0, 100);

    if (validWallets.length === 0) {
      return NextResponse.json({ success: false, error: 'valid wallets required' }, { status: 400 });
    }

    const clusters = await getClustersByWallet(validWallets);

    return NextResponse.json({
      success: true,
      clusters,
      totalClusters: clusters.length,
    });
  } catch (error) {
    console.error('[Blacklist API] POST error:', error);
    return NextResponse.json({ success: false, error: 'Lookup failed' }, { status: 500 });
  }
}
