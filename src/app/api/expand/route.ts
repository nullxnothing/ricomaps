import { NextRequest, NextResponse } from 'next/server';
import { expandNode } from '@/lib/graph-builder';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { ExpandResponse } from '@/lib/types';

const MAX_EXISTING_NODES = 500;

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'expand');
  if (!allowed) {
    return NextResponse.json<ExpandResponse>(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const { wallet, mode = 'funding', existingNodes = [] } = body;

    if (!wallet || !isValidSolanaAddress(wallet)) {
      return NextResponse.json<ExpandResponse>(
        { success: false, error: 'Invalid Solana wallet address' },
        { status: 400 }
      );
    }

    if (mode !== 'funding' && mode !== 'funded') {
      return NextResponse.json<ExpandResponse>(
        { success: false, error: 'Invalid mode. Use "funding" or "funded"' },
        { status: 400 }
      );
    }

    if (!Array.isArray(existingNodes) || existingNodes.length > MAX_EXISTING_NODES) {
      return NextResponse.json<ExpandResponse>(
        { success: false, error: `existingNodes must be an array of at most ${MAX_EXISTING_NODES} entries` },
        { status: 400 }
      );
    }

    const validatedNodes = existingNodes.filter(
      (n: unknown) => typeof n === 'string' && isValidSolanaAddress(n)
    );

    console.log(`Expanding node ${wallet} in ${mode} mode`);

    const existingNodeIds = new Set<string>(validatedNodes);
    const result = await expandNode(wallet, mode, existingNodeIds);

    const response: ExpandResponse = {
      success: true,
      newNodes: result.newNodes,
      newLinks: result.newLinks,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Expand error:', error);
    return NextResponse.json<ExpandResponse>(
      { success: false, error: 'Failed to expand node' },
      { status: 500 }
    );
  }
}
