import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { GATE_COOKIE, verifySession, type GateSession } from './gate';

/**
 * Guard for gated API routes. Returns the session if valid, or a 403 NextResponse
 * the caller should return immediately. Usage:
 *
 *   const gate = await requireGate(request);
 *   if (gate instanceof NextResponse) return gate;
 *   // gate.address is the verified holder
 */
export async function requireGate(request: NextRequest): Promise<GateSession | NextResponse> {
  const token = request.cookies.get(GATE_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'gated', gated: true, message: 'Hold $RICO and connect your wallet to unlock this feature.' },
      { status: 403 }
    );
  }
  return session;
}
