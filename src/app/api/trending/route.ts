import { NextResponse } from 'next/server';
import { getTrendingAndFeaturedTokens } from '@/lib/dexscreener';
import { TrendingResponse } from '@/lib/types';

export async function GET() {
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
