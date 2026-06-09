import { NextRequest, NextResponse } from 'next/server';
import { GATE_COOKIE, GATE_MINT, verifySession } from '@/lib/gate';

// Cheap status check the client polls on load — reads the cookie, no chain call.
export async function GET(request: NextRequest) {
  const session = await verifySession(request.cookies.get(GATE_COOKIE)?.value);
  return NextResponse.json({
    unlocked: !!session,
    address: session?.address ?? null,
    mint: GATE_MINT,
  });
}

// Sign out — clears the gate cookie.
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(GATE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
