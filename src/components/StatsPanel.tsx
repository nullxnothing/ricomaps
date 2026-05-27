'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { GraphData, AppMode, TokenSecurityInfo } from '@/lib/types';
import { analyzeGraph, calculateGraphStats } from '@/lib/graph-analysis';
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
