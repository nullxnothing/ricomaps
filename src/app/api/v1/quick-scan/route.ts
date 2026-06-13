import { NextRequest, NextResponse } from 'next/server';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { getCachedTokenScan } from '@/lib/db-cache';

export const maxDuration = 30;

// Open CORS so browser-based trading agents (and the rugcheck skill) can call
// this public endpoint cross-origin. Read-only scan, no credentials.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: { ...CORS_HEADERS, ...init?.headers },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Lightweight scan endpoint for extensions/embeds/agents.
 * Analyzes fewer holders (15) for faster response.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'scan');
  if (!allowed) {
    return json(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  try {
    const body = await request.json();
    const { address } = body;

    if (!address || !isValidSolanaAddress(address)) {
      return json({ success: false, error: 'Invalid address' }, { status: 400 });
    }

    // Check DB cache first (before isTokenMint check: cache might have it)
    const cached = await getCachedTokenScan(address);
    if (cached) {
      return json({
        success: true,
        data: cached.data,
        stats: cached.stats,
        tokenSecurity: cached.tokenSecurity,
        tokenMetadata: cached.tokenMetadata,
      });
    }

    // Fast scan: only 15 holders
    const result = await mapTokenHolders(address, { topN: 15, fundersPerHolder: 1 });

    return json({
      success: true,
      data: result.data,
      stats: result.stats,
      tokenSecurity: result.tokenSecurity,
      tokenMetadata: result.tokenMetadata,
    });
  } catch (error) {
    console.error('Quick scan error:', error);
    return json({ success: false, error: 'Scan failed' }, { status: 500 });
  }
}
