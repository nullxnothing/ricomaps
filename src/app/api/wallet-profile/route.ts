import { NextRequest, NextResponse } from 'next/server';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { getWalletBalances, getWalletFundedBy, getWalletTransfers } from '@/lib/helius';

interface WalletProfileResponse {
  success: boolean;
  balances?: Awaited<ReturnType<typeof getWalletBalances>>;
  fundedBy?: Awaited<ReturnType<typeof getWalletFundedBy>>;
  recentActivity?: {
    signature: string;
    timestamp: number;
    type: string;
    direction: 'in' | 'out';
    counterparty: string;
    mint: string;
    amount: number;
    symbol: string | null;
  }[];
  error?: string;
}

// In-memory cache: address -> { data, timestamp }
const profileCache = new Map<string, { data: WalletProfileResponse; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'wallet-profile');
  if (!allowed) {
    return NextResponse.json<WalletProfileResponse>(
      { success: false, error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const address = request.nextUrl.searchParams.get('address');
  if (!address || !isValidSolanaAddress(address)) {
    return NextResponse.json<WalletProfileResponse>(
      { success: false, error: 'Invalid Solana address' },
      { status: 400 }
    );
  }

  // Check cache
  const cached = profileCache.get(address);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const [balances, fundedBy, transfers] = await Promise.all([
      getWalletBalances(address),
      getWalletFundedBy(address),
      getWalletTransfers(address, { limit: 5, sortOrder: 'desc', direction: 'any', solMode: 'merged' }),
    ]);

    const recentActivity = (transfers?.data ?? []).map(transfer => ({
      signature: transfer.signature,
      timestamp: transfer.timestamp,
      type: transfer.type || 'transfer',
      direction: transfer.direction,
      counterparty: transfer.counterparty,
      mint: transfer.mint,
      amount: transfer.amount,
      symbol: transfer.symbol,
    }));

    const result: WalletProfileResponse = {
      success: true,
      balances,
      fundedBy,
      recentActivity,
    };

    profileCache.set(address, { data: result, timestamp: Date.now() });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Wallet profile fetch failed:', error);
    return NextResponse.json<WalletProfileResponse>(
      { success: false, error: 'Failed to fetch wallet profile' },
      { status: 500 }
    );
  }
}
