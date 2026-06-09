import { NextRequest, NextResponse } from 'next/server';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { requireGate } from '@/lib/gate-guard';
import { createWatchlist, listWatchlists, generateWatchlistId, userKeyForAddress } from '@/lib/db-watchlist';

const MAX_WALLETS = 25;

export async function GET(request: NextRequest) {
  const gate = await requireGate(request);
  if (gate instanceof NextResponse) return gate;

  const userKey = userKeyForAddress(gate.address);
  const watchlists = await listWatchlists(userKey);
  return NextResponse.json({ success: true, watchlists });
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed } = checkRateLimit(ip, 'watchlist');
  if (!allowed) return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });

  const gate = await requireGate(request);
  if (gate instanceof NextResponse) return gate;

  const body = await request.json().catch(() => ({}));
  const { label, funderWallets, fingerprintId } = body;

  if (typeof label !== 'string' || !label.trim()) {
    return NextResponse.json({ success: false, error: 'label required' }, { status: 400 });
  }
  if (!Array.isArray(funderWallets) || funderWallets.length === 0) {
    return NextResponse.json({ success: false, error: 'funderWallets must be a non-empty array' }, { status: 400 });
  }
  const wallets = funderWallets.filter((w: unknown) => typeof w === 'string' && isValidSolanaAddress(w)).slice(0, MAX_WALLETS);
  if (wallets.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid wallet addresses' }, { status: 400 });
  }

  const userKey = userKeyForAddress(gate.address);
  const entry = {
    id: generateWatchlistId(userKey, label),
    userKey,
    fingerprintId: typeof fingerprintId === 'string' ? fingerprintId : undefined,
    label: label.trim().slice(0, 256),
    funderWallets: wallets,
    createdAt: Math.floor(Date.now() / 1000),
  };
  await createWatchlist(entry);
  return NextResponse.json({ success: true, watchlist: entry });
}
