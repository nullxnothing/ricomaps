'use client';

import { useEffect, useRef } from 'react';
import type { GraphData, TokenMetadata, DeployerInfo } from '@/lib/types';
import { buildNarrativeBrief, type NarrativeStatsInput } from '@/lib/narrative-prompt';
import { useNarrativeStream } from '@/hooks/useNarrativeStream';
import { useGateContext } from '../GateProvider';

/**
 * Bottom-center AI read panel, toggled from the control dock. Auto-runs the
 * /api/explain stream when opened; reuses the shared narrative stream hook.
 */
interface GraphAIPanelProps {
  open: boolean;
  onClose: () => void;
  mint: string | null;
  data: GraphData;
  stats: NarrativeStatsInput | undefined;
  tokenMetadata: TokenMetadata | null;
  deployerInfo: DeployerInfo | null;
}

const CONFIDENCE_COLOR = {
  high: 'var(--green-primary)',
  medium: 'var(--amber-primary)',
  low: 'var(--text-tertiary)',
} as const;

export function GraphAIPanel({ open, onClose, mint, data, stats, tokenMetadata, deployerInfo }: GraphAIPanelProps) {
  const { unlocked, unlock } = useGateContext();
  const { text, factors, confidence, isStreaming, isDone, error, gated, generate, reset } = useNarrativeStream();
  const ranForRef = useRef<string | null>(null);

  // Auto-generate once per open (keyed by mint) when the panel opens.
  useEffect(() => {
    if (!open || !stats) return;
    if (ranForRef.current === mint) return;
    let cancelled = false;
    (async () => {
      if (!unlocked) {
        const ok = await unlock();
        if (!ok || cancelled) return;
      }
      ranForRef.current = mint;
      generate(mint, buildNarrativeBrief({ data, stats, tokenMetadata, deployerInfo }));
    })();
    return () => { cancelled = true; };
  }, [open, mint, stats, unlocked, unlock, generate, data, tokenMetadata, deployerInfo]);

  // Reset cache key when closed so reopening re-runs.
  useEffect(() => {
    if (!open) { ranForRef.current = null; reset(); }
  }, [open, reset]);

  if (!open) return null;

  return (
    <div className="glass-ai w-[440px] max-w-[calc(100vw-2rem)] p-3.5" style={{ animation: 'slideUp 0.2s ease-out' }}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--green-primary)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
            <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" />
          </svg>
          AI Read of This Graph
        </span>
        <div className="flex items-center gap-2">
          {confidence && isDone && (
            <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ color: CONFIDENCE_COLOR[confidence], background: 'var(--bg-elevated)' }}>
              {confidence}
            </span>
          )}
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {gated && <p className="text-[12.5px] text-amber-primary">Hold $RICO to unlock the AI read.</p>}

      {(text || isStreaming) && (
        <p className="text-[12.5px] leading-[1.72] text-[#b8b8b8]">
          {text}
          {isStreaming && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse align-middle" style={{ background: 'var(--green-primary)' }} />}
        </p>
      )}

      {factors.length > 0 && isDone && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {factors.map((f, i) => (
            <span key={i} className="rounded px-1.5 py-0.5 text-[10px]" style={{ color: 'var(--red-primary)', background: 'var(--red-ghost)' }}>{f}</span>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-[11px] text-red-primary">{error}</p>}
      {!text && !isStreaming && !error && !gated && (
        <p className="text-[12px] text-text-tertiary">Reading the graph…</p>
      )}
    </div>
  );
}

export default GraphAIPanel;
