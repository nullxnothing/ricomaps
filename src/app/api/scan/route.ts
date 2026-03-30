import { NextRequest, NextResponse } from 'next/server';
import { traceFundingChain } from '@/lib/graph-builder';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isTokenMint } from '@/lib/helius';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { ScanResponse, AppMode } from '@/lib/types';
import { getCachedTokenScan, setCachedTokenScan } from '@/lib/db-cache';

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
      // CHECK DATABASE CACHE FIRST - saves API calls!
      const cached = await getCachedTokenScan(address);
      if (cached) {
        console.log(`[CACHE HIT] Returning cached result for ${address.slice(0, 8)}...`);
        return NextResponse.json<ScanResponse>({
          success: true,
          mode,
          data: cached.data,
          stats: cached.stats as ScanResponse['stats'],
          tokenSecurity: cached.tokenSecurity,
          tokenMetadata: cached.tokenMetadata,
        });
      }

      // Token mode - map holder connections
      const result = await mapTokenHolders(address, {
        topN: 50,  // Match closer to Bubblemaps coverage
        fundersPerHolder: 1,
      });

      // STORE IN DATABASE CACHE for future requests
      setCachedTokenScan(
        address,
        result.data,
        result.stats as Record<string, unknown>,
        result.tokenSecurity,
        result.tokenMetadata
      ).catch(err => console.error('Cache store error:', err));

      return NextResponse.json<ScanResponse>({
        success: true,
        mode,
        data: result.data,
        stats: result.stats,
        tokenSecurity: result.tokenSecurity,
        tokenMetadata: result.tokenMetadata,
      });
    } else {
      // Wallet mode - trace funding chain (reduced params to conserve API)
      const data = await traceFundingChain(address, {
        maxDepth: 1,  // Reduced from 2
        maxNodesPerLevel: 10,  // Reduced from 20
        minAmount: 0.01,  // Increased from 0.001
      });

      return NextResponse.json<ScanResponse>({
        success: true,
        mode,
        data,
        stats: {
          nodesFound: data.nodes.length,
          linksFound: data.links.length,
          scanDepth: 1,
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
