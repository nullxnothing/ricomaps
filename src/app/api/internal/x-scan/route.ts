import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { isTokenMint } from '@/lib/helius';
import { scanTokenForensics } from '@/lib/scan-core';
import { getCachedTokenScan } from '@/lib/db-cache';
import { formatXReply } from '@/lib/x/format';

// Cache hits are instant; a cold scan holds the connection ~1s+.
export const maxDuration = 60;

interface XScanBody {
  mint?: string;
}

/**
 * Worker → app scan funnel for the X bot. The worker polls @mentions, extracts a
 * CA, and POSTs it here; we run the (cache-first) forensic scan and return a
 * ready-to-post, <=280-char reply. The worker then posts it as a reply tweet.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: XScanBody;
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
    // Fast path: a cached scan means this mint already passed the token gate on a
    // prior scan, so skip the ~0.4s isTokenMint DAS call and reply immediately.
    const cached = await getCachedTokenScan(mint);
    if (cached) {
      const result = {
        stats: cached.stats as Parameters<typeof formatXReply>[1]['stats'],
        tokenSecurity: cached.tokenSecurity,
        tokenMetadata: cached.tokenMetadata,
        deployerInfo: cached.deployerInfo,
      };
      return NextResponse.json({ success: true, text: formatXReply(mint, result) });
    }

    // Uncached: gate on token-mint before scanning. A wallet (or any non-fungible
    // account) returns notToken:true so the worker skips the reply (no scan, no
    // wasted X credits). DAS interface check, same gate /api/scan auto-detect uses.
    if (!(await isTokenMint(mint))) {
      return NextResponse.json({ success: true, notToken: true });
    }

    const result = await scanTokenForensics(mint);
    return NextResponse.json({ success: true, text: formatXReply(mint, result) });
  } catch (error) {
    console.error(`[x-scan] failed for ${mint}:`, error);
    return NextResponse.json({ success: false, error: 'Scan failed' }, { status: 500 });
  }
}
