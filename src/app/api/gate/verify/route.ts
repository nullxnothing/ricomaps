import { NextRequest, NextResponse } from 'next/server';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  GATE_COOKIE, GATE_MINT, buildSignMessage, isNonceFresh, verifyWalletSignature,
  checkGateBalance, issueSession,
} from '@/lib/gate';

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed } = checkRateLimit(ip, 'gate');
  if (!allowed) return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });

  const { address, signature, nonce, issuedAt } = await request.json().catch(() => ({}));

  if (!address || !isValidSolanaAddress(address) || !signature || !nonce || !issuedAt) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 });
  }
  if (!isNonceFresh(Number(issuedAt))) {
    return NextResponse.json({ success: false, error: 'Nonce expired, retry' }, { status: 400 });
  }

  const message = buildSignMessage(nonce, Number(issuedAt));
  if (!verifyWalletSignature(address, message, signature)) {
    return NextResponse.json({ success: false, error: 'Signature verification failed' }, { status: 401 });
  }

  // Signature proves ownership; now confirm they actually hold the token.
  const { ok, balance } = await checkGateBalance(address);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: 'no_balance', balance, mint: GATE_MINT, message: 'This wallet holds no $RICO.' },
      { status: 403 }
    );
  }

  const token = await issueSession(address, balance);
  const res = NextResponse.json({ success: true, address, balance });
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
  return res;
}
