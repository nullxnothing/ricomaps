'use client';

import { truncateAddress } from '@/lib/address-utils';
import type { RecentEvent } from '@/hooks/useGraphData';

const KIND_META: Record<RecentEvent['kind'], { dot: string; label: string; color: string }> = {
  buy: { dot: '🟢', label: 'bought', color: 'var(--green-primary)' },
  sell: { dot: '🔴', label: 'sold', color: 'var(--red-primary)' },
  out: { dot: '⚪', label: 'exited', color: 'var(--text-tertiary)' },
};

/**
 * Compact live ticker of recent buy/sell/exit events from the holder stream.
 * Driven by `recentEvents` (already coalesced to ≤1 update/frame in useGraphData),
 * so this re-renders cheaply and only mounts while streaming is active.
 */
export function LiveActivityFeed({ events }: { events: RecentEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 max-h-44 overflow-hidden rounded-lg backdrop-blur-md bg-black/70 border border-white/[0.06] px-2.5 py-2 w-48">
      <span className="text-[9px] uppercase tracking-wide text-text-tertiary mb-0.5">Live activity</span>
      {events.slice(0, 6).map(e => {
        const m = KIND_META[e.kind];
        return (
          <div key={e.id} className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className="flex-shrink-0">{m.dot}</span>
            <span className="text-text-secondary">{truncateAddress(e.owner, 4)}</span>
            <span style={{ color: m.color }}>{m.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default LiveActivityFeed;
