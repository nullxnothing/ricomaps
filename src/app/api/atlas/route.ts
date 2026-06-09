import { NextRequest, NextResponse } from 'next/server';
import { getAtlasGraph, type AtlasGraph } from '@/lib/db-cabal';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

const MAX_CABALS = 60;
const MAX_RECENT_TOKENS = 120;

// Assembling the graph hits trending + fingerprint + outcome queries (~500ms).
// Cache the result process-wide for a few seconds and serve stale instantly while
// a refresh runs in the background, so the page paints immediately on load.
const GRAPH_TTL_MS = 8_000;
let cached: { graph: AtlasGraph; at: number } | null = null;
let refreshing: Promise<AtlasGraph> | null = null;

async function loadGraph(): Promise<AtlasGraph> {
  if (refreshing) return refreshing;
  refreshing = getAtlasGraph({ maxCabals: MAX_CABALS, maxRecentTokens: MAX_RECENT_TOKENS })
    .then((g) => { cached = { graph: g, at: Date.now() }; return g; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/** The battlefield snapshot: top cabals, their tokens, fresh launches, HUD stats. */
export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'atlas');
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    const fresh = cached && Date.now() - cached.at < GRAPH_TTL_MS;
    if (cached && !fresh) void loadGraph(); // stale-while-revalidate in the background
    const graph = fresh && cached ? cached.graph : await loadGraph();
    return NextResponse.json(
      { success: true, ...graph },
      { headers: { 'Cache-Control': 'public, s-maxage=8, stale-while-revalidate=30' } }
    );
  } catch (error) {
    console.error('[Atlas] graph error:', error);
    return NextResponse.json({ success: false, error: 'Failed to build atlas graph' }, { status: 500 });
  }
}
