'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CabalFingerprintResult } from '@/lib/types';
import { truncateAddress } from '@/lib/address-utils';

interface CabalRapSheetProps {
  fingerprint: CabalFingerprintResult;
  onTokenScan?: (mint: string) => void;
}

const RUG_DOT: Record<string, string> = {
  green: 'var(--green-primary)',
  yellow: 'var(--amber-primary)',
  red: 'var(--red-primary)',
};

function priorTokenCount(fp: CabalFingerprintResult): number {
  const mints = new Set<string>();
  for (const m of fp.matches) for (const t of m.tokens) mints.add(t.mint);
  return mints.size;
}

export function CabalRapSheet({ fingerprint, onTokenScan }: CabalRapSheetProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  const [watchState, setWatchState] = useState<'idle' | 'saving' | 'saved' | 'gated'>('idle');

  if (!fingerprint.matches.length) return null;

  // The crew's funder wallets — what the radar watches for pre-launch fan-out.
  const funderAddresses = [...new Set(fingerprint.matches.flatMap(m => m.components.funderAddresses))];

  const watchCrew = async () => {
    if (funderAddresses.length === 0) return;
    setWatchState('saving');
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: `Crew ${fingerprint.id}`,
          funderWallets: funderAddresses,
          fingerprintId: fingerprint.id,
        }),
      });
      if (res.status === 403) { setWatchState('gated'); return; }
      const json = await res.json();
      setWatchState(json.success ? 'saved' : 'idle');
    } catch {
      setWatchState('idle');
    }
  };

  // Flatten prior tokens across all matched appearances, newest first, deduped by mint.
  const priorTokens = Array.from(
    new Map(
      fingerprint.matches
        .flatMap(m => m.tokens)
        .sort((a, b) => b.firstSeen - a.firstSeen)
        .map(t => [t.mint, t])
    ).values()
  );
  const rugs = priorTokens.filter(t => t.rugLevel === 'red').length;
  const maxConfidence = Math.max(...fingerprint.matches.map(m => m.confidence));

  return (
    <div className="mt-3 pt-3 border-t border-border-base">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold" style={{ color: 'var(--red-primary)' }}>
            Known crew
          </span>
          <span className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
            ran {priorTokenCount(fingerprint)} prior {priorTokenCount(fingerprint) === 1 ? 'token' : 'tokens'}
            {rugs > 0 && ` · ${rugs} rugged`}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{ color: 'var(--red-primary)', background: 'var(--red-ghost)' }}
          >
            {maxConfidence}%
          </span>
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ color: 'var(--text-tertiary)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-1.5">
          <span className="text-[10px] block" style={{ color: 'var(--text-tertiary)' }}>
            This crew also ran:
          </span>
          {priorTokens.map((token, i) => (
            <div key={i} className="flex items-center justify-between text-xs gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {token.rugLevel && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: RUG_DOT[token.rugLevel] }}
                    title={`${token.rugLevel} risk`}
                  />
                )}
                <span className="truncate" style={{ color: 'var(--text-primary)' }}>
                  {token.tokenSymbol ? `$${token.tokenSymbol}` : truncateAddress(token.mint, 4)}
                </span>
                {token.cabalSupplyPct !== undefined && token.cabalSupplyPct > 0 && (
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                    {token.cabalSupplyPct.toFixed(0)}% held
                  </span>
                )}
              </div>
              <button
                className="btn-ghost text-[10px] py-0.5 px-2 shrink-0"
                onClick={(e) => { e.stopPropagation(); onTokenScan?.(token.mint); }}
              >
                Scan
              </button>
            </div>
          ))}
          {funderAddresses.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (watchState === 'gated') { router.push('/watchlist'); return; }
                if (watchState === 'idle') watchCrew();
              }}
              disabled={watchState === 'saving'}
              className="w-full mt-1 py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-60"
              style={{
                background: watchState === 'saved' ? 'var(--green-ghost)' : 'var(--red-ghost)',
                color: watchState === 'saved' ? 'var(--green-primary)' : 'var(--red-primary)',
                border: `1px solid ${watchState === 'saved' ? 'rgba(0,255,65,0.25)' : 'var(--red-primary)'}`,
              }}
            >
              {watchState === 'saving' ? 'Adding…'
                : watchState === 'saved' ? '✓ Watching on Radar'
                : watchState === 'gated' ? 'Hold $RICO to watch →'
                : '◎ Watch this crew'}
            </button>
          )}

          <div className="text-[10px] font-mono pt-1" style={{ color: 'var(--text-tertiary)' }}>
            Fingerprint: {fingerprint.id}
          </div>
        </div>
      )}
    </div>
  );
}

export default CabalRapSheet;
