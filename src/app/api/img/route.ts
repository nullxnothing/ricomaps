import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 15;

// Same-origin proxy for token logos so the atlas canvas can draw them without
// CORS failures (dexscreener / geckoterminal / IPFS don't send CORS headers).
// Allowlist the known logo hosts to avoid an open proxy.
const ALLOWED_HOSTS = new Set([
  'dd.dexscreener.com',
  'assets.geckoterminal.com',
  'ipfs.io',
  'cf-ipfs.com',
  'cloudflare-ipfs.com',
  'arweave.net',
  'www.arweave.net',
  'image-cdn.solana.fm',
  'nftstorage.link',
]);

const ONE_DAY = 86_400;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('u');
  if (!raw) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }
  if (url.protocol !== 'https:' || (!ALLOWED_HOSTS.has(url.hostname) && !url.hostname.endsWith('.ipfs.nftstorage.link'))) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 400 });
  }

  try {
    const upstream = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'Upstream failed' }, { status: 502 });
    }
    const contentType = upstream.headers.get('content-type') ?? 'image/png';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Not an image' }, { status: 415 });
    }
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${ONE_DAY}, s-maxage=${ONE_DAY}, immutable`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Fetch failed' }, { status: 502 });
  }
}
