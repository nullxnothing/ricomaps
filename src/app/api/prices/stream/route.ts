import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { isVenumEnabled, getVenumApiKey, getVenumBaseUrl } from '@/lib/venum';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SSE proxy for Venum's real-time price stream (GET /v1/stream/prices).
 *
 * The browser connects to this same-origin route with an EventSource; we open
 * the upstream Venum stream server-side and pipe it through, injecting the
 * `x-api-key` header so the key never reaches the client. Events (`ready`,
 * `price`, `heartbeat`) pass through unmodified — see `useVenumPriceStream`.
 *
 *   GET /api/prices/stream?tokens=SOL,USDC&includeOptimistic=true
 */
export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'prices-stream');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  if (!isVenumEnabled()) {
    return NextResponse.json(
      { error: 'Live prices unavailable: VENUM_API_KEY is not configured' },
      { status: 503 }
    );
  }

  const tokens = request.nextUrl.searchParams.get('tokens');
  const includeOptimistic = request.nextUrl.searchParams.get('includeOptimistic');
  const dedupThreshold = request.nextUrl.searchParams.get('dedupThreshold');

  const upstream = new URLSearchParams();
  if (tokens) upstream.set('tokens', tokens);
  if (includeOptimistic) upstream.set('includeOptimistic', includeOptimistic);
  if (dedupThreshold) upstream.set('dedupThreshold', dedupThreshold);

  const url = `${getVenumBaseUrl()}/v1/stream/prices${upstream.toString() ? `?${upstream}` : ''}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, {
      headers: { Accept: 'text/event-stream', 'x-api-key': getVenumApiKey() },
      // Tie the upstream connection's lifetime to the client connection.
      signal: request.signal,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to reach Venum price stream' }, { status: 502 });
  }

  if (!upstreamRes.ok || !upstreamRes.body) {
    const status = upstreamRes.status === 401 || upstreamRes.status === 403 ? upstreamRes.status : 502;
    return NextResponse.json(
      { error: `Venum price stream error (${upstreamRes.status})` },
      { status }
    );
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
