import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { requireGate } from '@/lib/gate-guard';
import { getWatchlist, listActivity, recordActivity, userKeyForAddress } from '@/lib/db-watchlist';
import { batchGetFirstIncomingSolTransfers } from '@/lib/helius';
import { computeThreatScore } from '@/lib/threat-scorer';
import { GraphNode } from '@/lib/types';

// GET: stored alerts for this watchlist (poll fallback when SSE is unavailable).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireGate(request);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const watchlist = await getWatchlist(id, userKeyForAddress(gate.address));
  if (!watchlist) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const since = Number(request.nextUrl.searchParams.get('since')) || undefined;
  const activity = await listActivity(id, since);
  return NextResponse.json({ success: true, activity });
}

// POST: receive a fan-out roll-up from the browser, confirm recipients are fresh,
// score it, and persist as an alert. Body: { funderWallet, recipients[], totalSol, signature, slot }.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed } = checkRateLimit(ip, 'watchlist');
  if (!allowed) return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });

  const gate = await requireGate(request);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const watchlist = await getWatchlist(id, userKeyForAddress(gate.address));
  if (!watchlist) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { funderWallet, recipients, totalSol, signature } = body;

  if (!isValidSolanaAddress(funderWallet) || !Array.isArray(recipients)) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }
  const validRecipients = recipients.filter((r: unknown) => typeof r === 'string' && isValidSolanaAddress(r)).slice(0, 25);
  if (validRecipients.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid recipients' }, { status: 400 });
  }

  // Freshness confirmation: a recipient is "fresh" if this fan-out tx was its first
  // incoming SOL: i.e. a brand-new wallet, the pre-launch tell.
  let freshCount = validRecipients.length;
  try {
    const firstIn = await batchGetFirstIncomingSolTransfers(validRecipients, { fallbackToFundedBy: false, concurrency: 6 });
    if (typeof signature === 'string' && signature) {
      freshCount = validRecipients.filter(r => firstIn.get(r)?.txSignature === signature || firstIn.get(r) === null).length;
    }
  } catch {
    // Freshness check is best-effort; fall through with the raw count.
  }

  // Threat score from a synthetic funder node (fresh fan-out → cabal-funder shape).
  const synthetic: GraphNode = {
    id: funderWallet, label: funderWallet, val: 0, color: '', type: 'cabal-funder', depth: 0, expanded: false,
    metadata: { fundedCount: validRecipients.length, walletAgeDays: 0, suspicious: true },
  };
  const threatScore = computeThreatScore(synthetic);

  const activity = {
    id: crypto.createHash('sha256').update(`${id}:${funderWallet}:${signature ?? Date.now()}`).digest('hex').slice(0, 16),
    watchlistId: id,
    funderWallet,
    recipients: validRecipients,
    walletCount: freshCount,
    totalSol: Number(totalSol) || 0,
    threatScore,
    detectedAt: Math.floor(Date.now() / 1000),
    signature: typeof signature === 'string' ? signature : '',
    acknowledged: false,
  };
  await recordActivity(activity);
  return NextResponse.json({ success: true, activity });
}
