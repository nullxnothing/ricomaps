import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedInternal } from '@/lib/internal-auth';
import { getTrackedHandles, recordXSnapshot, markHandlesResolved } from '@/lib/x-account-history';
import type { XAccountSnapshot } from '@/lib/types';

// Worker ↔ app bridge for the X recycled-account tracker.
//   GET  → the handle queue the daily worker should resolve.
//   POST → snapshots the worker captured from X (+ which handles it resolved).
// Secret-gated; never public.

export async function GET(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = Math.min(200, Number(new URL(request.url).searchParams.get('limit')) || 100);
  try {
    const handles = await getTrackedHandles(limit);
    return NextResponse.json({ success: true, handles });
  } catch (error) {
    console.error('[x-track] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Load failed' }, { status: 500 });
  }
}

interface PostBody {
  snapshots?: XAccountSnapshot[];
  resolved?: string[];   // handles the worker attempted this cycle (rotate the queue)
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedInternal(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const snapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
  try {
    for (const snap of snapshots) {
      if (!snap?.userId || !snap?.username) continue;
      await recordXSnapshot({ ...snap, seenAt: snap.seenAt || Math.floor(Date.now() / 1000) });
    }
    if (Array.isArray(body.resolved) && body.resolved.length) {
      await markHandlesResolved(body.resolved);
    }
    return NextResponse.json({ success: true, recorded: snapshots.length });
  } catch (error) {
    console.error('[x-track] POST failed:', error);
    return NextResponse.json({ success: false, error: 'Save failed' }, { status: 500 });
  }
}
