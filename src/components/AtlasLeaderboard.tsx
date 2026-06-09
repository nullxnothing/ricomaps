'use client';

import { useState } from 'react';
import type { AtlasCabalNode } from '@/lib/types';
import { formatUsd } from '@/lib/format';

/**
 * Most-Wanted rail: top crews ranked by damage (extracted, then reach). Doubles
 * as the page's "useful info at a glance" surface and a clickable index into the
 * map — selecting a row drives the same focus-mode path as clicking a core.
 */

interface AtlasLeaderboardProps {
  cabals: AtlasCabalNode[];
  selectedId: string | null;
  onSelect: (cabal: AtlasCabalNode) => void;
}

const MAX_ROWS = 8;

function rank(cabals: AtlasCabalNode[]): AtlasCabalNode[] {
  return [...cabals]
    .sort((a, b) => b.estExtractedUsd - a.estExtractedUsd || b.ruggedCount - a.ruggedCount || b.tokenCount - a.tokenCount)
    .slice(0, MAX_ROWS);
}

export function AtlasLeaderboard({ cabals, selectedId, onSelect }: AtlasLeaderboardProps) {
  const [collapsed, setCollapsed] = useState(false);
  if (cabals.length === 0) return null;
  const rows = rank(cabals);

  return (
    <div className="glass-panel-floating rounded-lg w-[220px] overflow-hidden pointer-events-auto select-none">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/[0.03] transition-colors"
        style={{ borderBottom: collapsed ? 'none' : '1px solid var(--border-base)' }}
      >
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-text-secondary">
          Most wanted
        </span>
        <svg
          width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`text-text-tertiary transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!collapsed && (
        <div className="py-1">
          {rows.map((c, i) => {
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c)}
                className="w-full flex items-center gap-2.5 px-3 py-[7px] text-left transition-colors"
                style={{ background: active ? 'rgba(239,68,68,0.1)' : 'transparent' }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <span className="font-mono text-[10px] text-text-tertiary w-3 flex-shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] font-bold" style={{ color: active ? 'var(--red-primary)' : 'var(--text-primary)' }}>
                    C-{c.id.slice(0, 4).toUpperCase()}
                  </div>
                  <div className="font-mono text-[9px] text-text-tertiary">
                    {c.tokenCount} token{c.tokenCount === 1 ? '' : 's'}
                    {c.ruggedCount > 0 ? ` · ${c.ruggedCount} rug${c.ruggedCount === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
                {c.estExtractedUsd > 0 && (
                  <span className="font-mono text-[10px] font-semibold text-red-primary flex-shrink-0">
                    {formatUsd(c.estExtractedUsd)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
