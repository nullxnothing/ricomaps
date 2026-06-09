import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { getCabalFingerprints } from '@/lib/cabal-fingerprint';

export const maxDuration = 15;

// Bounds on what the worker watches — keeps the LaserStream wallet filter cheap.
const MAX_CABALS = 40;
const WALLETS_PER_CABAL = 8;
const MAX_TOTAL_WALLETS = Number(process.env.ATLAS_MAX_WALLETS ?? 200);

/**
 * Cabal wallet rosters for the atlas worker to watch for live buys. Top crews by
 * confidence (most-active surface first), each trimmed to its first N wallets,
 * with a hard global cap. Read-only over the fingerprint store — no scan cost.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { fingerprints } = await getCabalFingerprints({ limit: MAX_CABALS });
    const rosters: { cabalId: string; wallets: string[] }[] = [];
    let total = 0;

    for (const fp of fingerprints) {
      if (total >= MAX_TOTAL_WALLETS) break;
      const wallets = [...new Set(fp.knownWallets)].slice(0, WALLETS_PER_CABAL);
      const room = MAX_TOTAL_WALLETS - total;
      const trimmed = wallets.slice(0, room);
      if (trimmed.length === 0) continue;
      rosters.push({ cabalId: fp.id, wallets: trimmed });
      total += trimmed.length;
    }

    return NextResponse.json({ success: true, rosters, walletCount: total });
  } catch (error) {
    console.error('[Cabal Rosters] failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to build rosters' }, { status: 500 });
  }
}
