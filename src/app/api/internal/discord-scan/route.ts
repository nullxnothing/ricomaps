import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { isTokenMint } from '@/lib/helius';
import { scanTokenForensics } from '@/lib/scan-core';
import { getCachedTokenScan } from '@/lib/db-cache';
import { formatDiscordCard } from '@/lib/discord/format';

export const maxDuration = 60;

interface DiscordScanBody {
  mint?: string;
}

/**
 * Worker → app scan funnel for the Discord GATEWAY auto-detect. The worker sees a CA
 * pasted in a channel and POSTs it here; we run the (cache-first) forensic scan and
 * return a ready-to-post plain-text card. A non-token returns notToken:true so the
 * gateway stays quiet (no reply spam on wallets).
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: DiscordScanBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mint } = body;
  if (!mint || !isValidSolanaAddress(mint)) {
    return NextResponse.json({ success: false, error: 'Invalid mint' }, { status: 400 });
  }

  try {
    const cached = await getCachedTokenScan(mint);
    if (cached) {
      const result = {
        stats: cached.stats as Parameters<typeof formatDiscordCard>[1]['stats'],
        tokenSecurity: cached.tokenSecurity,
        tokenMetadata: cached.tokenMetadata,
        deployerInfo: cached.deployerInfo,
      };
      return NextResponse.json({ success: true, text: formatDiscordCard(mint, result) });
    }

    if (!(await isTokenMint(mint))) {
      return NextResponse.json({ success: true, notToken: true });
    }

    const result = await scanTokenForensics(mint);
    return NextResponse.json({ success: true, text: formatDiscordCard(mint, result) });
  } catch (error) {
    console.error(`[discord-scan] failed for ${mint}:`, error);
    return NextResponse.json({ success: false, error: 'Scan failed' }, { status: 500 });
  }
}
