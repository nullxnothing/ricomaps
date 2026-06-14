import { NextRequest, NextResponse } from 'next/server';
import { getXIdentityByUsername, normalizeHandle, trackHandles } from '@/lib/x-account-history';

// Public read: resolve an X @handle to its cross-time identity — current handle,
// prior handles (recycling evidence), and linked token CAs. GET /api/v1/x-account?handle=foo
// An unknown handle is auto-queued for the daily tracker so the next lookup has data.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get('handle');
  const handle = normalizeHandle(raw);
  if (!handle) {
    return NextResponse.json(
      { success: false, error: 'Provide a valid X handle: ?handle=username' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const identity = await getXIdentityByUsername(handle);
  if (!identity) {
    // Not tracked yet — queue it so a follow-up call resolves. Honest "tracking started".
    await trackHandles([handle]);
    return NextResponse.json(
      {
        success: true,
        tracked: false,
        handle,
        message: 'Not in the tracker yet. Queued for resolution — check back shortly.',
      },
      { headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    { success: true, tracked: true, identity, timestamp: new Date().toISOString() },
    { headers: CORS_HEADERS },
  );
}
