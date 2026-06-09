'use client';

import type { AtlasStats } from '@/lib/types';
import { formatUsd } from '@/lib/format';

/**
 * Top-left intel readout: live status, headline counts, and the node legend.
 * Pure presentation — numbers come from the graph snapshot, "LIVE" from SSE.
 */

interface AtlasHudProps {
  stats: AtlasStats | null;
  live: boolean;
  streamSupported: boolean;
}

// Token status colors — the legend that needs explaining at a glance.
const STATUS_LEGEND = [
  { color: '#00d938', label: 'Alive' },
  { color: '#ef4444', label: 'Rugged' },
  { color: '#3a3a46', label: 'Dead' },
] as const;

function StatRow({ label, value, accent }: { label: string; value: string; accent?: 'red' | 'green' }) {
  const color = accent === 'red' ? 'var(--red-primary)' : accent === 'green' ? 'var(--green-primary)' : 'var(--text-primary)';
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="stats-label">{label}</span>
      <span className="font-mono text-[15px] font-bold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

export function AtlasHud({ stats, live, streamSupported }: AtlasHudProps) {
  return (
    <div className="glass-panel-floating rounded-lg p-3.5 w-[228px] pointer-events-auto select-none">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-text-secondary">
          Atlas
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em]">
          {live ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-green-primary" style={{ animation: 'tx-pulse 2s ease-in-out infinite' }} />
              <span className="text-green-primary">Live</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
              <span className="text-text-tertiary">{streamSupported ? 'Connecting' : 'Snapshot'}</span>
            </>
          )}
        </span>
      </div>

      <p className="text-[11px] leading-snug text-text-tertiary mb-3">
        Crews that funded multiple holders of the same token, mapped across pump.fun.
      </p>

      <div className="flex flex-col gap-[7px]">
        <StatRow label="Crews tracked" value={stats ? String(stats.cabalsTracked) : '—'} accent="red" />
        <StatRow label="Active · 24h" value={stats ? String(stats.cabalsActive24h) : '—'} />
        <StatRow label="Tokens tracked" value={stats ? String(stats.tokensTracked) : '—'} />
        <StatRow label="Rugs · 24h" value={stats ? String(stats.rugs24h) : '—'} accent={stats && stats.rugs24h > 0 ? 'red' : undefined} />
        {stats && stats.totalExtractedUsd > 0 && (
          <StatRow label="Extracted" value={formatUsd(stats.totalExtractedUsd)} accent="red" />
        )}
      </div>

      {/* Key: explain what the marks MEAN, not just their colors. */}
      <div className="mt-3.5 pt-3 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--border-base)' }}>
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.05em] text-text-tertiary">
          <span className="w-[11px] h-[11px] rounded-full flex-shrink-0" style={{ background: 'var(--red-primary)' }} />
          Crew — bigger = more tokens
        </span>
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.05em] text-text-tertiary">
          <span className="w-[11px] flex-shrink-0" style={{ height: 1.5, background: 'linear-gradient(90deg, var(--red-primary), var(--green-primary))' }} />
          Controls token
        </span>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
          {STATUS_LEGEND.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.05em] text-text-tertiary">
              <span className="w-[7px] h-[7px] rounded-full" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
