import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { listOutcomeCandidates, upsertAtlasToken, AtlasTokenStatus } from '@/lib/db-cabal';
import { fetchMarketDataBatch } from '@/lib/dexscreener';

export const maxDuration = 30;

const BATCH_SIZE = 30;                 // DexScreener batch endpoint cap
const RUG_DROP_FRACTION = 0.9;         // ≥90% fall from peak liquidity = rug
const MIN_PEAK_FOR_RUG_USD = 1_000;    // dust pools can't "rug"
const DEAD_LIQUIDITY_USD = 500;
const MIN_AGE_FOR_DEAD_SEC = 3_600;    // give fresh launches an hour before declaring death

/**
 * Outcome pass over tracked tokens: re-price via DexScreener, mark rugged/dead/alive,
 * and estimate extracted USD as the fall from peak liquidity. Driven by the worker timer.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const candidates = await listOutcomeCandidates(BATCH_SIZE);
  if (candidates.length === 0) {
    return NextResponse.json({ success: true, checked: 0 });
  }

  const market = await fetchMarketDataBatch(candidates.map(t => t.mint));
  const now = Math.floor(Date.now() / 1000);
  const counts: Record<AtlasTokenStatus, number> = { watching: 0, scanned: 0, alive: 0, rugged: 0, dead: 0 };
  const rugEvents: { mint: string; symbol?: string; estExtractedUsd: number }[] = [];

  for (const token of candidates) {
    const snapshot = market.get(token.mint);
    const liquidityUsd = snapshot?.liquidityUsd ?? 0;
    const peak = Math.max(token.peakLiquidityUsd ?? 0, liquidityUsd);

    let status: AtlasTokenStatus = 'alive';
    let estExtractedUsd: number | undefined;
    if (peak >= MIN_PEAK_FOR_RUG_USD && liquidityUsd <= peak * (1 - RUG_DROP_FRACTION)) {
      status = 'rugged';
      estExtractedUsd = Math.round(peak - liquidityUsd);
    } else if (liquidityUsd < DEAD_LIQUIDITY_USD && now - token.createdAt > MIN_AGE_FOR_DEAD_SEC) {
      status = 'dead';
    }

    counts[status]++;
    if (status === 'rugged' && token.status !== 'rugged') {
      rugEvents.push({ mint: token.mint, symbol: token.symbol, estExtractedUsd: estExtractedUsd ?? 0 });
    }

    await upsertAtlasToken({
      mint: token.mint,
      status,
      liquidityUsd,
      marketCapUsd: snapshot?.marketCapUsd,
      lastCheckedAt: now,
      estExtractedUsd,
    });
  }

  return NextResponse.json({
    success: true,
    checked: candidates.length,
    alive: counts.alive,
    rugged: counts.rugged,
    dead: counts.dead,
    rugEvents, // worker broadcasts these as atlas rug-event SSE frames
  });
}
