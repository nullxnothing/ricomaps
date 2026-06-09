'use client';

import { timeAgo } from '@/lib/format';

/**
 * Bottom-left signal feed: the last few live events, newest first, each with a
 * colored rail matching its node color on the map.
 */

export type TickerKind = 'spawn' | 'graduation' | 'cabal' | 'rug' | 'buy';

export interface TickerEntry {
  id: string;
  kind: TickerKind;
  text: string;
  sub?: string;
  ts: number;
}

const RAIL_COLORS: Record<TickerKind, string> = {
  spawn: '#6b6b78',
  graduation: '#00d938',
  cabal: '#a78bfa',
  rug: '#ef4444',
  buy: '#22d3ee',
};

const KIND_LABELS: Record<TickerKind, string> = {
  spawn: 'Launch',
  graduation: 'Graduated',
  cabal: 'Cabal hit',
  rug: 'Rug',
  buy: 'Crew buy',
};

interface AtlasTickerProps {
  entries: TickerEntry[];
}

export function AtlasTicker({ entries }: AtlasTickerProps) {
  if (entries.length === 0) return null;

  return (
    <div className="glass-panel-floating rounded-lg w-[268px] overflow-hidden pointer-events-auto select-none">
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-base)' }}>
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-text-tertiary">
          Signal feed
        </span>
        <span className="font-mono text-[9px] text-text-tertiary">{entries.length}</span>
      </div>
      <div className="max-h-[224px] overflow-y-auto themed-scrollbar">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-start gap-2.5 px-3 py-[7px]"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', animation: 'tx-slide-in 0.35s ease-out' }}
          >
            <span className="mt-[5px] w-[3px] h-[18px] rounded-full flex-shrink-0" style={{ background: RAIL_COLORS[entry.kind] }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: RAIL_COLORS[entry.kind] }}>
                  {KIND_LABELS[entry.kind]}
                </span>
                <span className="font-mono text-[9px] text-text-tertiary flex-shrink-0">{timeAgo(entry.ts)}</span>
              </div>
              <div className="text-[11.5px] text-text-secondary truncate leading-snug">{entry.text}</div>
              {entry.sub && <div className="font-mono text-[9.5px] text-text-tertiary truncate">{entry.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
