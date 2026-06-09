'use client';

import { GraphData, TokenMetadata, DeployerInfo } from '@/lib/types';
import { buildNarrativeBrief, NarrativeStatsInput } from '@/lib/narrative-prompt';
import { useNarrativeStream } from '@/hooks/useNarrativeStream';
import { useGateContext } from './GateProvider';

interface NarrativePanelProps {
  mint: string | null;
  data: GraphData | null;
  stats: NarrativeStatsInput | undefined;
  tokenMetadata: TokenMetadata | null;
  deployerInfo: DeployerInfo | null;
}

const CONFIDENCE_COLOR = {
  high: 'var(--green-primary)',
  medium: 'var(--amber-primary)',
  low: 'var(--text-tertiary)',
} as const;

function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

export function NarrativePanel({ mint, data, stats, tokenMetadata, deployerInfo }: NarrativePanelProps) {
  const { unlocked, unlock } = useGateContext();
  const { text, factors, confidence, isStreaming, isDone, error, gated, generate } = useNarrativeStream();

  if (!data || !stats) return null;

  const run = async () => {
    if (!unlocked) {
      const ok = await unlock();
      if (!ok) return;
    }
    const brief = buildNarrativeBrief({ data, stats, tokenMetadata, deployerInfo });
    generate(mint, brief);
  };

  const hasOutput = text.length > 0 || isStreaming;

  // Idle state — a compact pill, not a loud full-width box.
  if (!hasOutput && !error) {
    return (
      <button
        onClick={run}
        className="group inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium backdrop-blur-md transition-colors"
        style={{
          background: 'rgba(0,0,0,0.7)',
          border: '1px solid var(--border-base)',
          color: 'var(--text-secondary)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'rgba(0,255,65,0.3)';
          e.currentTarget.style.color = 'var(--green-primary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-base)';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }}
      >
        <span style={{ color: 'var(--green-primary)' }}><SparkleIcon /></span>
        <span className="whitespace-nowrap">
          {gated ? 'Hold $RICO for AI read' : 'AI read of this graph'}
        </span>
      </button>
    );
  }

  // Output state — a contained, readable card.
  return (
    <div
      className="w-[clamp(280px,32vw,400px)] rounded-lg p-3 backdrop-blur-md"
      style={{ background: 'rgba(0,0,0,0.78)', border: '1px solid var(--border-base)' }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-tertiary)' }}>
          <span style={{ color: 'var(--green-primary)' }}><SparkleIcon /></span>
          AI Read
        </span>
        {confidence && isDone && (
          <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ color: CONFIDENCE_COLOR[confidence], background: 'var(--bg-elevated)' }}>
            {confidence} confidence
          </span>
        )}
      </div>

      {hasOutput && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {text}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse align-middle" style={{ background: 'var(--green-primary)' }} />
          )}
        </p>
      )}

      {factors.length > 0 && isDone && (
        <div className="mt-2 flex flex-wrap gap-1">
          {factors.map((f, i) => (
            <span key={i} className="rounded px-1.5 py-0.5 text-[10px]" style={{ color: 'var(--red-primary)', background: 'var(--red-ghost)' }}>
              {f}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--red-primary)' }}>{error}</p>
      )}
    </div>
  );
}
