'use client';

import type { AtlasCabalNode } from '@/lib/types';
import { formatUsd } from '@/lib/format';

/**
 * Atlas right rail (286px) — Most-Wanted leaderboard. Ranks crews by damage and
 * doubles as a clickable index into the map (selecting drives focus mode).
 */
interface AtlasMostWantedProps {
  cabals: AtlasCabalNode[];
  selectedId: string | null;
  onSelect: (cabal: AtlasCabalNode) => void;
  className?: string;
}

// Per-rank accent so the rail reads as distinct crews (the map itself colors by
// funder category; this is purely a leaderboard cue).
const RANK_COLORS = ['#ef4444', '#f59e0b', '#a78bfa', '#22d3ee', '#60a5fa', '#34d399'];
const MAX_ROWS = 8;

function rank(cabals: AtlasCabalNode[]): AtlasCabalNode[] {
  return [...cabals]
    .sort((a, b) => b.estExtractedUsd - a.estExtractedUsd || b.ruggedCount - a.ruggedCount || b.tokenCount - a.tokenCount)
    .slice(0, MAX_ROWS);
}

export function AtlasMostWanted({ cabals, selectedId, onSelect, className }: AtlasMostWantedProps) {
  const rows = rank(cabals);

  return (
    <aside className={`rail rail--right ${className ?? ''}`} style={{ width: 286, gap: 10 }} aria-label="Most wanted crews">
      <div className="flex items-center gap-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red-primary)" strokeWidth="2">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-red-primary">Most Wanted</span>
      </div>

      {rows.length === 0 && (
        <p className="text-[11.5px] text-text-tertiary leading-snug">No crews tracked yet. Run a few token scans to populate the atlas.</p>
      )}

      {rows.map((c, i) => {
        const color = RANK_COLORS[i % RANK_COLORS.length];
        const active = c.id === selectedId;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="surface-card w-full flex items-center gap-2.5 p-3 text-left transition-colors"
            style={{
              borderColor: active ? 'var(--border-hover)' : 'var(--border-base)',
              background: active ? 'var(--bg-hover)' : 'var(--bg-surface)',
            }}
            onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border-hover)'; } }}
            onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-base)'; } }}
          >
            <span className="w-[9px] h-[9px] rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[12.5px] font-bold text-text-primary">C-{c.id.slice(0, 4).toUpperCase()}</div>
              <div className="font-mono text-[10px] text-text-tertiary">
                {c.tokenCount} token{c.tokenCount === 1 ? '' : 's'}
                {c.ruggedCount > 0 ? ` · ${c.ruggedCount} rug${c.ruggedCount === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              {c.estExtractedUsd > 0 && (
                <>
                  <div className="font-mono text-[12.5px] font-bold text-amber-primary">{formatUsd(c.estExtractedUsd)}</div>
                  <div className="font-mono text-[9px] text-text-tertiary uppercase">Extracted</div>
                </>
              )}
            </div>
          </button>
        );
      })}
    </aside>
  );
}

export default AtlasMostWanted;
