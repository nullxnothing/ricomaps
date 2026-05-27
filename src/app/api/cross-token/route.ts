import { NextRequest, NextResponse } from 'next/server';
import { analyzeCrossTokenHoldings } from '@/lib/cross-token-analyzer';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';

const MAX_WALLETS = 20;
const CREDITS_PER_WALLET = 100;

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'cross-token');
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
      return NextResponse.json(
        { success: false, error: 'wallets must be a non-empty array' },
        { status: 400 }
      );
    }

    if (wallets.length > MAX_WALLETS) {
      return NextResponse.json(
        { success: false, error: `Maximum ${MAX_WALLETS} wallets allowed` },
        { status: 400 }
      );
    }

    const invalidWallets = wallets.filter((w: unknown) => typeof w !== 'string' || !isValidSolanaAddress(w));
    if (invalidWallets.length > 0) {
      return NextResponse.json(
        { success: false, error: `Invalid Solana address(es): ${invalidWallets.slice(0, 3).join(', ')}` },
        { status: 400 }
      );
    }

    const apiKey = process.env.HELIUS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const result = await analyzeCrossTokenHoldings(wallets, apiKey);

    return NextResponse.json({
      success: true,
      ...result,
      creditsEstimate: wallets.length * CREDITS_PER_WALLET,
    });
  } catch (error) {
    console.error('Cross-token analysis error:', error);
    return NextResponse.json(
      { success: false, error: 'Cross-token analysis failed' },
      { status: 500 }
    );
  }
}
