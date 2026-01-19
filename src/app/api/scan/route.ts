import { NextRequest, NextResponse } from 'next/server';
import { traceFundingChain } from '@/lib/graph-builder';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isTokenMint } from '@/lib/helius';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { ScanResponse, AppMode } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body;

    // Validate address
    if (!address || !isValidSolanaAddress(address)) {
      return NextResponse.json<ScanResponse>(
        { success: false, error: 'Invalid Solana address' },
        { status: 400 }
      );
    }

    console.log(`Auto-detecting address type for ${address}`);

    // Auto-detect if this is a token mint or wallet
    const isToken = await isTokenMint(address);
    const mode: AppMode = isToken ? 'token' : 'wallet';

    console.log(`Detected mode: ${mode}`);

    if (mode === 'token') {
      // Token mode - map holder connections
      const result = await mapTokenHolders(address, {
        topN: 50,
        fundersPerHolder: 5,
      });

      return NextResponse.json<ScanResponse>({
        success: true,
        mode,
        data: result.data,
        stats: result.stats,
        tokenSecurity: result.tokenSecurity,
        tokenMetadata: result.tokenMetadata,
      });
    } else {
      // Wallet mode - trace funding chain
      const data = await traceFundingChain(address, {
        maxDepth: 2,
        maxNodesPerLevel: 20,
        minAmount: 0.001,
      });

      return NextResponse.json<ScanResponse>({
        success: true,
        mode,
        data,
        stats: {
          nodesFound: data.nodes.length,
          linksFound: data.links.length,
          scanDepth: 2,
        },
      });
    }
  } catch (error) {
    console.error('Scan error:', error);
    return NextResponse.json<ScanResponse>(
      { success: false, error: 'Failed to scan address' },
      { status: 500 }
    );
  }
}
