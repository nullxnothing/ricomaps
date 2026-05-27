import { NextRequest, NextResponse } from 'next/server';
import { traceFundingChain } from '@/lib/graph-builder';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { TraceResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'trace');
  if (!allowed) {
    return NextResponse.json<TraceResponse>(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const { wallet, depth = 2 } = body;

    if (!wallet || !isValidSolanaAddress(wallet)) {
      return NextResponse.json<TraceResponse>(
        { success: false, error: 'Invalid Solana wallet address' },
        { status: 400 }
      );
    }

    const maxDepth = Math.min(Math.max(1, depth), 3);

    console.log(`Tracing funding chain for ${wallet} with depth ${maxDepth}`);

    const data = await traceFundingChain(wallet, {
      maxDepth,
      maxNodesPerLevel: 20,
      minAmount: 0.001,
    });

    const response: TraceResponse = {
      success: true,
      data,
      stats: {
        nodesFound: data.nodes.length,
        linksFound: data.links.length,
        scanDepth: maxDepth,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Trace error:', error);
    return NextResponse.json<TraceResponse>(
      { success: false, error: 'Failed to trace funding chain' },
      { status: 500 }
    );
  }
}
