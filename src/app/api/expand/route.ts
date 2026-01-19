import { NextRequest, NextResponse } from 'next/server';
import { expandNode } from '@/lib/graph-builder';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { ExpandResponse } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet, mode = 'funding', existingNodes = [] } = body;

    // Validate wallet address
    if (!wallet || !isValidSolanaAddress(wallet)) {
      return NextResponse.json<ExpandResponse>(
        { success: false, error: 'Invalid Solana wallet address' },
        { status: 400 }
      );
    }

    // Validate mode
    if (mode !== 'funding' && mode !== 'funded') {
      return NextResponse.json<ExpandResponse>(
        { success: false, error: 'Invalid mode. Use "funding" or "funded"' },
        { status: 400 }
      );
    }

    console.log(`Expanding node ${wallet} in ${mode} mode`);

    const existingNodeIds = new Set<string>(existingNodes);
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
