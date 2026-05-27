import { NextRequest, NextResponse } from 'next/server';
import { getTrendingAndFeaturedTokens } from '@/lib/dexscreener';
import { checkRateLimit } from '@/lib/rate-limit';
import { TrendingResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'trending');
  if (!allowed) {
    return NextResponse.json<TrendingResponse>(
      { success: false, trending: [], featured: [], error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  try {
    console.log('Fetching trending tokens from DexScreener');

    const { trending, featured } = await getTrendingAndFeaturedTokens();

    const response: TrendingResponse = {
      success: true,
      trending,
      featured,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Trending tokens error:', error);
    return NextResponse.json<TrendingResponse>(
      { success: false, trending: [], featured: [], error: 'Failed to fetch trending tokens' },
      { status: 500 }
    );
  }
}
