import { NextRequest, NextResponse } from 'next/server';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { TokenResponse } from '@/lib/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'token');
  if (!allowed) {
    return NextResponse.json<TokenResponse>(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const { mint, topHolders = 20 } = body;

    if (!mint || !isValidSolanaAddress(mint)) {
      return NextResponse.json<TokenResponse>(
        { success: false, error: 'Invalid Solana token mint address' },
        { status: 400 }
      );
    }

    const maxHolders = Math.min(Math.max(10, topHolders), 30);

    console.log(`Mapping token holders for ${mint}, analyzing top ${maxHolders}`);

    const result = await mapTokenHolders(mint, {
      topN: maxHolders,
      fundersPerHolder: 5,
    });

    const response: TokenResponse = {
      success: true,
      data: result.data,
      stats: result.stats,
      tokenSecurity: result.tokenSecurity,
      tokenMetadata: result.tokenMetadata,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Token mapping error:', error);
    return NextResponse.json<TokenResponse>(
      { success: false, error: 'Failed to map token holders' },
      { status: 500 }
    );
  }
}
