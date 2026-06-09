import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildSignMessage } from '@/lib/gate';

// Stateless nonce: the nonce + issuedAt are echoed back in /verify and bound into
// the signed message, so no server-side nonce store is needed. The signature over
// the exact message (with a fresh issuedAt) is the anti-replay guarantee.
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed } = checkRateLimit(ip, 'gate');
  if (!allowed) return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });

  const { address } = await request.json().catch(() => ({}));
  if (!address || !isValidSolanaAddress(address)) {
    return NextResponse.json({ success: false, error: 'Invalid address' }, { status: 400 });
  }

  const nonce = crypto.randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  return NextResponse.json({ success: true, nonce, issuedAt, message: buildSignMessage(nonce, issuedAt) });
}
