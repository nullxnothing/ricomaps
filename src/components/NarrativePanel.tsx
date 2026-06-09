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

  return (
    <div className="glass-panel p-3 max-w-md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          AI Read
        </span>
        {confidence && isDone && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: CONFIDENCE_COLOR[confidence], background: 'var(--bg-elevated)' }}>
            {confidence} confidence
          </span>
        )}
      </div>

      {!hasOutput && !error && (
        <button
          onClick={run}
          className="w-full py-2 rounded text-xs font-medium transition-colors"
          style={{ background: 'var(--green-ghost)', color: 'var(--green-primary)', border: '1px solid rgba(0,255,65,0.25)' }}
        >
          {gated ? 'Hold $RICO to explain' : '✦ Explain this graph'}
        </button>
      )}

      {gated && (
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
          The AI read is a holder-only feature.
        </p>
      )}

      {hasOutput && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {text}
          {isStreaming && <span className="inline-block w-1.5 h-3 ml-0.5 align-middle animate-pulse" style={{ background: 'var(--green-primary)' }} />}
        </p>
      )}

      {factors.length > 0 && isDone && (
        <div className="flex flex-wrap gap-1 mt-2">
          {factors.map((f, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--red-primary)', background: 'var(--red-ghost)' }}>
              {f}
            </span>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] mt-1" style={{ color: 'var(--red-primary)' }}>{error}</p>}
    </div>
  );
}
