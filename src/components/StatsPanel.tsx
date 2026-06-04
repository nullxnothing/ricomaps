'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { GraphData, AppMode, TokenSecurityInfo, SupplyConcentration } from '@/lib/types';
import { analyzeGraph, calculateGraphStats } from '@/lib/graph-analysis';
import { giniLabel } from '@/lib/supply-metrics';
import { TokenSecurityBadge } from './TokenSecurityBadge';
import { BorderBeam } from './ui/border-beam';

export type StatsFilter = 'cabal' | 'snipers' | 'bundles' | null;

interface StatsPanelProps {
  data: GraphData | null;
  mode: AppMode;
  stats?: {
    nodesFound?: number;
    linksFound?: number;
    scanDepth?: number;
    totalHolders?: number;
    rawHolderCount?: number;
    filteredOut?: number;
    analyzedHolders?: number;
    analysisIncomplete?: boolean;
    cabalConnectionsFound?: number;
    suspiciousWallets?: string[];
    dexFundedHolders?: number;
    freshWalletFunders?: number;
    snipersDetected?: number;
    sniperWallets?: string[];
    bundleClustersDetected?: number;
    bundledWallets?: string[];
    supplyConcentration?: SupplyConcentration;
  };
  tokenSecurity?: TokenSecurityInfo | null;
  streaming?: {
    isStreaming: boolean;
    transactionCount: number;
  };
  onFilter?: (filter: StatsFilter) => void;
  activeFilter?: StatsFilter;
}

export function StatsPanel({ data, mode, stats, tokenSecurity, onFilter, activeFilter = null }: StatsPanelProps) {
  const graphStats = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const analyzedNodes = analyzeGraph(data.nodes, data.links);
    return calculateGraphStats(analyzedNodes);
  }, [data]);

  if (!data || !stats) return null;

  const cabalFunders = data.nodes.filter(n => n.type === 'cabal-funder');
  const cabalHolders = data.nodes.filter(n => n.type === 'connected' || (n.metadata?.sharedFunderGroup));

  return (
    <div className="glass-panel w-full md:w-56 xl:w-64 2xl:w-72 max-h-[40vh] sm:max-h-[60vh] overflow-y-auto themed-scrollbar p-2.5 sm:p-3.5">
      {/* Security badge (compact) */}
      {mode === 'token' && (
        <div className="mb-3">
          <TokenSecurityBadge security={tokenSecurity || null} />
        </div>
      )}

      {/* Supply concentration — the headline metric traders screenshot */}
      {mode === 'token' && stats.supplyConcentration && (
        <SupplyConcentrationPanel sc={stats.supplyConcentration} />
      )}

      {/* Core stats */}
      <div className="space-y-0">
        {mode === 'token' && stats.totalHolders && (
          <div className="stats-item">
            <span className="stats-label">Holders</span>
            <span className="stats-value">{stats.analyzedHolders} / {stats.totalHolders.toLocaleString()}</span>
          </div>
        )}

        {mode === 'wallet' && (
          <div className="stats-item">
            <span className="stats-label">Nodes</span>
            <span className="stats-value">{data.nodes.length}</span>
          </div>
        )}

        {graphStats && graphStats.componentCount > 0 && (
          <div className="stats-item">
            <span className="stats-label">Clusters</span>
            <span className="stats-value">
              {graphStats.componentCount}
              {graphStats.largestComponentSize > 1 && (
                <span className="text-xs ml-1 text-text-tertiary">
                  (max {graphStats.largestComponentSize})
                </span>
              )}
            </span>
          </div>
        )}

        {/* Cabal line */}
        {cabalFunders.length > 0 && (
          <button
            type="button"
            className="stats-item-btn relative"
            onClick={() => onFilter?.(activeFilter === 'cabal' ? null : 'cabal')}
            aria-pressed={activeFilter === 'cabal'}
            title="Filter graph to cabal funders"
          >
            <span className="stats-label text-red-primary">Cabal</span>
            <span className="stats-value text-red-primary">
              {cabalFunders.length} &rarr; {cabalHolders.length}
            </span>
            {activeFilter === 'cabal' && (
              <BorderBeam size={45} duration={4} colorFrom="#ef4444" colorTo="#ff8888" />
            )}
          </button>
        )}

        {/* Snipers */}
        {mode === 'token' && stats.snipersDetected !== undefined && stats.snipersDetected > 0 && (
          <button
            type="button"
            className="stats-item-btn relative"
            onClick={() => onFilter?.(activeFilter === 'snipers' ? null : 'snipers')}
            aria-pressed={activeFilter === 'snipers'}
            title="Filter graph to snipers"
          >
            <span className="stats-label">Snipers</span>
            <span className="stats-value text-cyan-primary">{stats.snipersDetected}</span>
            {activeFilter === 'snipers' && (
              <BorderBeam size={45} duration={4} colorFrom="#22d3ee" colorTo="#67e8f9" />
            )}
          </button>
        )}

        {/* Bundles */}
        {mode === 'token' && stats.bundleClustersDetected !== undefined && stats.bundleClustersDetected > 0 && (
          <div className="flex items-stretch gap-1">
            <button
              type="button"
              className="stats-item-btn relative flex-1"
              onClick={() => onFilter?.(activeFilter === 'bundles' ? null : 'bundles')}
              aria-pressed={activeFilter === 'bundles'}
              title="Filter graph to bundled wallets"
            >
              <span className="stats-label text-purple-primary">Bundles</span>
              <span className="stats-value text-purple-primary">
                {stats.bundleClustersDetected} ({stats.bundledWallets?.length || 0} wallets)
              </span>
              {activeFilter === 'bundles' && (
                <BorderBeam size={45} duration={4} colorFrom="#a78bfa" colorTo="#c4b5fd" />
              )}
            </button>
            <Link
              href="/blacklist"
              className="flex items-center justify-center w-7 rounded text-purple-primary/70 hover:text-purple-primary hover:bg-white/[0.04] transition-colors"
              title="Open blacklist"
              aria-label="Open blacklist"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M7 17L17 7M17 7H8M17 7v9" />
              </svg>
            </Link>
          </div>
        )}
      </div>

      {/* Risk indicator */}
      {mode === 'token' && (
        <div className="mt-3 pt-3 border-t border-border-base">
          <RiskBadge
            cabalCount={cabalFunders.length}
            sniperCount={stats.snipersDetected || 0}
            totalHolders={stats.analyzedHolders || data.nodes.length}
          />
        </div>
      )}

      {/* Clean status for no cabal */}
      {mode === 'token' && cabalFunders.length === 0 && (!stats.cabalConnectionsFound || stats.cabalConnectionsFound === 0) && (
        <div className="mt-3 pt-3 border-t border-border-base">
          <span className="text-xs text-text-tertiary">No shared funders detected</span>
        </div>
      )}

      {stats.analysisIncomplete && (
        <div className="mt-2 text-xs text-text-tertiary">
          Partial analysis (API limits)
        </div>
      )}
    </div>
  );
}

// Severity color for a supply-held %. Higher concentration in insider hands = redder.
function pctColor(pct: number): string {
  if (pct >= 20) return 'var(--red-primary)';
  if (pct >= 10) return 'var(--amber-primary)';
  return 'var(--green-primary)';
}

function fmtPct(pct: number | undefined): string {
  return `${(pct ?? 0).toFixed(1)}%`;
}

function SupplyConcentrationPanel({ sc }: { sc: SupplyConcentration }) {
  const gini = giniLabel(sc.giniCoefficient ?? 0);
  const giniColor =
    gini === 'Extreme' ? 'var(--red-primary)'
    : gini === 'Concentrated' ? 'var(--amber-primary)'
    : 'var(--green-primary)';

  // Low coverage = the analyzed top holders represent only a small slice of supply
  // (rest is in the AMM pool / untracked). Concentration metrics are then "among
  // top holders", not token-wide — say so instead of implying false safety.
  // Older cached scans may lack analyzedSupplyPct; treat unknown coverage as full
  // so we don't show a misleading low-coverage warning on legacy payloads.
  const lowCoverage = sc.analyzedSupplyPct !== undefined && sc.analyzedSupplyPct < 50;

  return (
    <div className="mb-3 pb-3 border-b border-border-base">
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <BigStat label="Bundled" value={fmtPct(sc.bundledSupplyPct)} color={pctColor(sc.bundledSupplyPct)} />
        <BigStat label="Sniped" value={fmtPct(sc.sniperSupplyPct)} color={pctColor(sc.sniperSupplyPct)} />
        <BigStat label="Top 10" value={fmtPct(sc.top10Pct)} color={pctColor(sc.top10Pct)} />
      </div>

      <div className="space-y-0">
        {(sc.bundledSupplyPct > 0 || sc.sniperSupplyPct > 0) && (
          <div className="stats-item">
            <span className="stats-label">Insiders hold</span>
            <span className="stats-value" style={{ color: pctColor(sc.insiderStillHoldingPct) }}>
              {fmtPct(sc.insiderStillHoldingPct)}
            </span>
          </div>
        )}
        {sc.cabalSupplyPct > 0 && (
          <div className="stats-item">
            <span className="stats-label text-red-primary">Cabal supply</span>
            <span className="stats-value text-red-primary">{fmtPct(sc.cabalSupplyPct)}</span>
          </div>
        )}
        <div className="stats-item">
          <span className="stats-label">{lowCoverage ? 'Spread (top holders)' : 'Concentration'}</span>
          <span className="stats-value" style={{ color: giniColor }}>
            {gini} <span className="text-text-tertiary">({sc.giniCoefficient.toFixed(2)})</span>
          </span>
        </div>
        {sc.freshWalletPct > 0 && (
          <div className="stats-item">
            <span className="stats-label">Fresh wallets</span>
            <span className="stats-value">{fmtPct(sc.freshWalletPct)}</span>
          </div>
        )}
        <div className="stats-item">
          <span className="stats-label">Real holders</span>
          <span className="stats-value">{sc.realHolderCount}</span>
        </div>
        {sc.analyzedSupplyPct !== undefined && (
          <div className="stats-item">
            <span className="stats-label">Supply covered</span>
            <span className="stats-value" style={{ color: lowCoverage ? 'var(--amber-primary)' : 'var(--green-primary)' }}>
              {fmtPct(sc.analyzedSupplyPct)}
            </span>
          </div>
        )}
      </div>

      <p className="mt-1.5 text-[10px] leading-tight text-text-tertiary">
        {lowCoverage
          ? `Top ${sc.realHolderCount} holders = ${fmtPct(sc.analyzedSupplyPct)} of supply (rest in pool/untracked). %s are of total supply held.`
          : `% of circulating supply held${sc.supplyDenominatorSource === 'sum' ? ' (est. — mint supply unavailable)' : ''}.`}
      </p>
    </div>
  );
}

function BigStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col items-center rounded bg-white/[0.02] py-1.5">
      <span className="text-sm font-semibold tabular-nums" style={{ color }}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</span>
    </div>
  );
}

function RiskBadge({ cabalCount, sniperCount, totalHolders }: { cabalCount: number; sniperCount: number; totalHolders: number }) {
  const cabalRatio = totalHolders > 0 ? cabalCount / totalHolders : 0;
  const sniperRatio = totalHolders > 0 ? sniperCount / totalHolders : 0;

  let level: 'low' | 'medium' | 'high';
  let label: string;

  if (cabalRatio > 0.1 || cabalCount >= 5) {
    level = 'high';
    label = 'High risk';
  } else if (cabalCount > 0 || sniperRatio > 0.15) {
    level = 'medium';
    label = 'Medium risk';
  } else {
    level = 'low';
    label = 'Low risk';
  }

  const colorMap = {
    low: 'var(--green-primary)',
    medium: 'var(--amber-primary)',
    high: 'var(--red-primary)',
  };

  const bgMap = {
    low: 'var(--green-ghost)',
    medium: 'var(--amber-ghost)',
    high: 'var(--red-ghost)',
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-tertiary">Risk</span>
      <span
        className="text-xs font-medium px-2 py-0.5 rounded"
        style={{ color: colorMap[level], background: bgMap[level] }}
      >
        {label}
      </span>
    </div>
  );
}

export default StatsPanel;
