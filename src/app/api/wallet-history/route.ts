import { NextRequest, NextResponse } from 'next/server';
import { getWalletHistory } from '@/lib/helius';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'wallet-history');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const address = request.nextUrl.searchParams.get('address');
  const limitParam = parseInt(request.nextUrl.searchParams.get('limit') || '5', 10);
  const limit = Math.min(Math.max(1, limitParam), 20);

  if (!address || !isValidSolanaAddress(address)) {
    return NextResponse.json({ error: 'Valid Solana address required' }, { status: 400 });
  }

  try {
    const history = await getWalletHistory(address, limit);
    return NextResponse.json({ history }, {
      headers: { 'Cache-Control': 'private, max-age=120' },
    });
  } catch (error) {
    console.error('Wallet history error:', error);
    return NextResponse.json({ error: 'Failed to fetch wallet history' }, { status: 500 });
  }
}
