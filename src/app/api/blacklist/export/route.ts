import { NextRequest, NextResponse } from 'next/server';
import { getBundleClusters } from '@/lib/db-blacklist';
import { checkRateLimit } from '@/lib/rate-limit';

function csvCell(value: string | number): string {
  const raw = String(value);
  if (/^[=+\-@]/.test(raw)) return `"'${raw.replace(/"/g, '""')}"`;
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const { allowed, retryAfterMs } = checkRateLimit(ip, 'blacklist');
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

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
        rows.push([
          wallet,
          cluster.id,
          cluster.wallets.length,
          cluster.confidence,
          cluster.sharedFunder || '',
          tokenMints,
          lastSeen,
        ].map(csvCell).join(','));
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
