import { NextRequest, NextResponse } from 'next/server';
import { traceFundingChain } from '@/lib/graph-builder';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isTokenMint } from '@/lib/helius';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { ScanResponse, AppMode } from '@/lib/types';
import { getCachedTokenScan, setCachedTokenScan } from '@/lib/db-cache';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'scan');
  if (!allowed) {
    return NextResponse.json<ScanResponse>(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const { address } = body;

    if (!address || !isValidSolanaAddress(address)) {
      return NextResponse.json<ScanResponse>(
        { success: false, error: 'Invalid Solana address' },
        { status: 400 }
      );
    }

    console.log(`Auto-detecting address type for ${address}`);

    const isToken = await isTokenMint(address);
    const mode: AppMode = isToken ? 'token' : 'wallet';

    console.log(`Detected mode: ${mode}`);

    if (mode === 'token') {
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

      const result = await mapTokenHolders(address, {
        topN: 30,
        fundersPerHolder: 1,
      });

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
      const data = await traceFundingChain(address, {
        maxDepth: 1,
        maxNodesPerLevel: 10,
        minAmount: 0.01,
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
