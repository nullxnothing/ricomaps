import { NextRequest, NextResponse } from 'next/server';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { upsertAtlasToken } from '@/lib/db-cabal';
import { pLimit } from '@/lib/concurrency';

export const maxDuration = 60;

// Auto-scans are cheaper than user scans: fewer holders, fewer funder hops.
const AUTO_SCAN_TOP_N = 20;
const AUTO_SCAN_FUNDERS_PER_HOLDER = 3;

// Backpressure: the worker fires on every graduation; cap in-flight + queued
// scans per instance so a launch wave can't burn the credit budget.
const MAX_PENDING = 6;
const scanLimit = pLimit(2);
let pending = 0;

interface AutoScanBody {
  mint?: string;
  name?: string;
  symbol?: string;
  createdAt?: number;     // unix seconds — pump.fun create time
  graduatedAt?: number;   // unix seconds — bonding-curve completion
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: AutoScanBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { mint, name, symbol, createdAt, graduatedAt } = body;
  if (!mint || !isValidSolanaAddress(mint)) {
    return NextResponse.json({ success: false, error: 'Invalid mint address' }, { status: 400 });
  }

  if (pending >= MAX_PENDING) {
    return NextResponse.json({ success: false, error: 'Scan queue full', pending }, { status: 429 });
  }

  // Register the token immediately so the atlas shows it even if the scan fails.
  await upsertAtlasToken({ mint, name, symbol, status: 'watching', createdAt, graduatedAt });

  pending++;
  try {
    const result = await scanLimit(() =>
      mapTokenHolders(mint, { topN: AUTO_SCAN_TOP_N, fundersPerHolder: AUTO_SCAN_FUNDERS_PER_HOLDER })
    );
    return NextResponse.json({
      success: true,
      mint,
      rugLevel: result.stats.rugScore?.level,
      cabalSupplyPct: result.stats.supplyConcentration?.cabalSupplyPct,
      bundledSupplyPct: result.stats.supplyConcentration?.bundledSupplyPct,
      bundleClusters: result.stats.bundleClustersDetected ?? 0,
      fingerprintMatches: result.stats.cabalFingerprint?.matches.length ?? 0,
    });
  } catch (error) {
    console.error(`[AutoScan] failed for ${mint}:`, error);
    return NextResponse.json({ success: false, error: 'Scan failed' }, { status: 500 });
  } finally {
    pending--;
  }
}
