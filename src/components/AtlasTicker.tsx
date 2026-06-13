'use client';

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

// Event colors per the redesign spec: spawn blue, buy green, cabal purple,
// graduation amber, rug red.
const KIND_COLORS: Record<TickerKind, string> = {
  spawn: '#60a5fa',
  graduation: '#f59e0b',
  cabal: '#a78bfa',
  rug: '#ef4444',
  buy: '#34d399',
};

const KIND_LABELS: Record<TickerKind, string> = {
  spawn: 'Spawn',
  graduation: 'Grad',
  cabal: 'Cabal',
  rug: 'Rug',
  buy: 'Buy',
};

interface AtlasTickerProps {
  entries: TickerEntry[];
}

export function AtlasTicker({ entries }: AtlasTickerProps) {
  if (entries.length === 0) return null;

  return (
    <div className="glass-legend w-[236px] overflow-hidden pointer-events-auto select-none" style={{ maxHeight: 216, padding: 0 }}>
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span className="rm-live-dot" />
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-text-secondary">Live Feed</span>
      </div>
      <div className="overflow-y-auto themed-scrollbar" style={{ maxHeight: 168 }}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-2.5 px-3 py-[6px]"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', animation: 'rm-tickin 0.35s ease-out' }}
          >
            <span className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: KIND_COLORS[entry.kind] }} />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11.5px] text-text-secondary truncate leading-tight">{entry.text}</div>
              {entry.sub && <div className="text-[10px] text-text-tertiary truncate leading-tight">{entry.sub}</div>}
            </div>
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.06em] flex-shrink-0" style={{ color: KIND_COLORS[entry.kind] }}>
              {KIND_LABELS[entry.kind]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
