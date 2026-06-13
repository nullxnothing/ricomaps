'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AtlasCabalNode, AtlasGraph, AtlasToken, CabalIntel } from '@/lib/types';
import { formatUsd, timeAgo } from '@/lib/format';
import { truncateAddress } from '@/lib/address-utils';

/**
 * Right-side dossier: opens when a cabal core or token dot is selected.
 * Cabals get the rap-sheet treatment; tokens get vitals + a scan shortcut.
 */

interface AtlasDossierProps {
  cabal: AtlasCabalNode | null;
  token: AtlasToken | null;
  graph: AtlasGraph | null;
  onClose: () => void;
}

const STATUS_BADGE: Record<AtlasToken['status'], { label: string; cls: string }> = {
  watching: { label: 'Watching', cls: 'badge-warning' },
  scanned: { label: 'Scanned', cls: 'badge-success' },
  alive: { label: 'Alive', cls: 'badge-success' },
  rugged: { label: 'Rugged', cls: 'badge-danger' },
  dead: { label: 'Dead', cls: 'badge-warning' },
};

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div className="stats-label mb-0.5">{label}</div>
      <div className="font-mono text-[13px] font-bold" style={{ color: danger ? 'var(--red-primary)' : 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

function formatSol(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const num = abs >= 1000 ? `${(abs / 1000).toFixed(1)}K` : abs >= 1 ? abs.toFixed(1) : abs.toFixed(2);
  return `${sign}${num} SOL`;
}

/** Live "what are they doing now" section: bags + SOL-flow PnL, fetched on select. */
interface IntelState {
  intel: CabalIntel | null;
  phase: 'loading' | 'ready' | 'empty' | 'error';
}

// Mounted with `key={cabal.id}` by the parent, so each crew gets a fresh
// instance. The effect just fetches once, no in-effect reset needed.
function CabalIntelSection({ cabalId }: { cabalId: string }) {
  const [{ intel, phase: state }, setData] = useState<IntelState>({ intel: null, phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cabal/${cabalId}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success && data.intel) {
          const hasSignal = data.intel.positions.length > 0 || data.intel.topWallets.some((w: { realizedSol: number }) => Math.abs(w.realizedSol) > 0.01);
          setData({ intel: data.intel as CabalIntel, phase: hasSignal ? 'ready' : 'empty' });
        } else {
          setData({ intel: null, phase: 'empty' });
        }
      } catch {
        if (!cancelled) setData({ intel: null, phase: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [cabalId]);

  return (
    <div className="mt-3.5 pt-3" style={{ borderTop: '1px solid var(--border-base)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="stats-label">Live intel</span>
        {state === 'loading' && <span className="spinner" style={{ width: 11, height: 11 }} />}
      </div>

      {state === 'error' && <div className="text-[11px] text-text-tertiary">Couldn&apos;t reach the wallets.</div>}
      {state === 'empty' && <div className="text-[11px] text-text-tertiary">No active bags or recent flow.</div>}

      {intel && state === 'ready' && (
        <>
          <div className="flex items-center justify-between mb-3 px-2.5 py-2 rounded-md" style={{ background: 'rgba(255,255,255,0.025)' }}>
            <div>
              <div className="stats-label mb-0.5">Net realized</div>
              <div className="font-mono text-[14px] font-bold" style={{ color: intel.netRealizedSol >= 0 ? 'var(--green-primary)' : 'var(--red-primary)' }}>
                {formatSol(intel.netRealizedSol)}
              </div>
            </div>
            <div className="text-right">
              <div className="stats-label mb-0.5">Holding now</div>
              <div className="font-mono text-[14px] font-bold text-text-primary">{formatUsd(intel.totalPortfolioUsd)}</div>
            </div>
          </div>

          {intel.positions.length > 0 && (
            <>
              <div className="stats-label mb-1.5">Current bags · {intel.walletsAnalyzed}/{intel.walletsTotal} wallets</div>
              <div className="flex flex-col gap-0.5">
                {intel.positions.map((pos) => (
                  <Link
                    key={pos.mint}
                    href={`/?address=${pos.mint}`}
                    className="flex items-center gap-2 py-[5px] px-1.5 -mx-1.5 rounded-md hover:bg-white/[0.04] transition-colors group"
                  >
                    {pos.logoUri
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={pos.logoUri} alt="" className="w-[18px] h-[18px] rounded-full flex-shrink-0" style={{ background: 'var(--bg-elevated)' }} />
                      : <span className="w-[18px] h-[18px] rounded-full flex-shrink-0" style={{ background: 'var(--bg-elevated)' }} />}
                    <span className="text-[11.5px] font-medium text-text-secondary group-hover:text-text-primary truncate flex-1">
                      ${pos.symbol}
                    </span>
                    {pos.holderCount > 1 && (
                      <span className="font-mono text-[9px] text-amber-primary flex-shrink-0" title={`${pos.holderCount} crew wallets hold this`}>
                        ×{pos.holderCount}
                      </span>
                    )}
                    <span className="font-mono text-[11px] font-semibold text-text-primary flex-shrink-0">{formatUsd(pos.usdValue)}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} className="btn-back" aria-label="Close dossier" style={{ width: 26, height: 26 }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}

export function AtlasDossier({ cabal, token, graph, onClose }: AtlasDossierProps) {
  if (!cabal && !token) return null;

  if (token) {
    const badge = STATUS_BADGE[token.status];
    return (
      <div className="glass-panel w-[280px] p-4 pointer-events-auto" style={{ animation: 'slideUp 0.2s ease-out' }}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-text-primary truncate">
              {token.name ?? token.symbol ?? truncateAddress(token.mint)}
            </div>
            <div className="font-mono text-[10px] text-text-tertiary truncate">
              {token.symbol ? `$${token.symbol} · ` : ''}{truncateAddress(token.mint)}
            </div>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        <div className="flex items-center gap-2 mb-3.5">
          <span className={badge.cls}>{badge.label}</span>
          {token.rugLevel && (
            <span className={token.rugLevel === 'red' ? 'badge-danger' : token.rugLevel === 'yellow' ? 'badge-warning' : 'badge-success'}>
              Risk: {token.rugLevel}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
          {token.liquidityUsd !== undefined && <Stat label="Liquidity" value={formatUsd(token.liquidityUsd)} />}
          {token.marketCapUsd !== undefined && <Stat label="Mcap" value={formatUsd(token.marketCapUsd)} />}
          {token.cabalSupplyPct !== undefined && token.cabalSupplyPct > 0 && (
            <Stat label="Cabal supply" value={`${token.cabalSupplyPct.toFixed(1)}%`} danger />
          )}
          {token.estExtractedUsd !== undefined && token.estExtractedUsd > 0 && (
            <Stat label="Extracted" value={formatUsd(token.estExtractedUsd)} danger />
          )}
          <Stat label="First seen" value={timeAgo(token.createdAt, true)} />
        </div>

        <Link href={`/?address=${token.mint}`} className="node-action-btn w-full justify-center">
          Scan holder map
        </Link>
      </div>
    );
  }

  const cabalTokens = graph && cabal
    ? graph.edges
        .filter((e) => e.cabalId === cabal.id)
        .map((e) => ({ edge: e, token: graph.tokens.find((t) => t.mint === e.mint) }))
        .filter((x): x is { edge: typeof x.edge; token: AtlasToken } => !!x.token)
        .sort((a, b) => b.token.createdAt - a.token.createdAt)
    : [];

  return (
    <div className="glass-panel-danger w-[300px] p-4 pointer-events-auto flex flex-col max-h-full overflow-y-auto themed-scrollbar">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="font-mono text-[15px] font-bold text-red-primary tracking-wide">
            CABAL C-{cabal!.id.slice(0, 4).toUpperCase()}
          </div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-text-tertiary mt-0.5">
            {cabal!.funderCategory} funding · active {timeAgo(cabal!.lastSeen, true)}
          </div>
        </div>
        <CloseButton onClose={onClose} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3.5">
        <Stat label="Tokens hit" value={String(cabal!.tokenCount)} />
        <Stat label="Wallets" value={String(cabal!.walletCount)} />
        <Stat label="Rugged" value={String(cabal!.ruggedCount)} danger={cabal!.ruggedCount > 0} />
        <Stat label="Extracted" value={formatUsd(cabal!.estExtractedUsd)} danger={cabal!.estExtractedUsd > 0} />
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="stats-label">Confidence</span>
          <span className="font-mono text-[11px] font-bold text-text-primary">{cabal!.confidence}%</span>
        </div>
        <div className="security-meter-track">
          <div
            className="security-meter-fill"
            style={{ width: `${cabal!.confidence}%`, background: cabal!.confidence >= 70 ? 'var(--red-primary)' : 'var(--amber-primary)' }}
          />
        </div>
      </div>

      <CabalIntelSection key={cabal!.id} cabalId={cabal!.id} />

      {cabalTokens.length > 0 && (
        <div className="mt-3.5 pt-3" style={{ borderTop: '1px solid var(--border-base)' }}>
          <div className="stats-label mb-1.5">Token history</div>
          {cabalTokens.map(({ edge, token: t }) => (
            <Link
              key={t.mint}
              href={`/?address=${t.mint}`}
              className="flex items-center justify-between gap-2 py-[7px] px-1.5 -mx-1.5 rounded-md hover:bg-white/[0.04] transition-colors group"
            >
              <div className="min-w-0">
                <div className="text-[11.5px] font-medium text-text-secondary group-hover:text-text-primary truncate">
                  {t.symbol ? `$${t.symbol}` : t.name ?? truncateAddress(t.mint)}
                </div>
                <div className="font-mono text-[9px] text-text-tertiary">
                  {timeAgo(t.createdAt, true)}{edge.supplyPct ? ` · held ${edge.supplyPct.toFixed(1)}%` : ''}
                </div>
              </div>
              <span
                className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                style={{
                  background: t.status === 'rugged' ? '#ef4444' : t.status === 'alive' ? '#00d938' : t.status === 'dead' ? '#3a3a46' : '#b8b8c2',
                }}
                title={t.status}
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
