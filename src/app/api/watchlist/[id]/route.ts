import { NextRequest, NextResponse } from 'next/server';
import { requireGate } from '@/lib/gate-guard';
import { deleteWatchlist, userKeyForAddress } from '@/lib/db-watchlist';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireGate(request);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  await deleteWatchlist(id, userKeyForAddress(gate.address));
  return NextResponse.json({ success: true });
}
