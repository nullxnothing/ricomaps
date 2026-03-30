import { NextResponse } from 'next/server';
import { getBundleClusters } from '@/lib/db-blacklist';

export async function GET() {
  try {
    const { clusters } = await getBundleClusters({
      limit: 1000,
      offset: 0,
      sortBy: 'confidence',
      sortDir: 'desc',
    });

    // Build CSV rows: one row per wallet with cluster context
    const header = 'wallet,cluster_id,cluster_size,confidence,shared_funder,tokens_seen,last_seen\n';
    const rows: string[] = [];

    for (const cluster of clusters) {
      const tokenMints = cluster.tokens.map(t => t.tokenSymbol || t.mint).join(';');
      const lastSeen = new Date(cluster.lastSeenTimestamp * 1000).toISOString();

      for (const wallet of cluster.wallets) {
        rows.push(
          `${wallet},${cluster.id},${cluster.wallets.length},${cluster.confidence},${cluster.sharedFunder || ''},${tokenMints},${lastSeen}`
        );
      }
    }

    const csv = header + rows.join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="blacklist-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error('[Blacklist Export] Error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
