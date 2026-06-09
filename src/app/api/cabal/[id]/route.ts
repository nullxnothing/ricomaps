import { NextRequest, NextResponse } from 'next/server';
import { getCabalIntel } from '@/lib/cabal-intel';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

const ID_RE = /^[0-9a-f]{16}$/;

/** Live intel for one cabal: current bags + SOL-flow PnL across its wallets. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'cabal-intel');
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const { id } = await params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid cabal id' }, { status: 400 });
  }

  try {
    const intel = await getCabalIntel(id);
    if (!intel) {
      return NextResponse.json({ success: false, error: 'Cabal not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, intel });
  } catch (error) {
    console.error(`[Cabal Intel] failed for ${id}:`, error);
    return NextResponse.json({ success: false, error: 'Failed to load cabal intel' }, { status: 500 });
  }
}
