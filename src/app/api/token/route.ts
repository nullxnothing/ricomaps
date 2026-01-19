import { NextRequest, NextResponse } from 'next/server';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { TokenResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mint, topHolders = 20 } = body;  // Reduced default for rate limit handling

    // Validate mint address
    if (!mint || !isValidSolanaAddress(mint)) {
      return NextResponse.json<TokenResponse>(
        { success: false, error: 'Invalid Solana token mint address' },
        { status: 400 }
      );
    }

    // Limit top holders to prevent excessive API calls
    const maxHolders = Math.min(Math.max(10, topHolders), 30);  // Max reduced to 30

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
