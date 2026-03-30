'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { GraphData, AppMode, TokenSecurityInfo } from '@/lib/types';
import { analyzeGraph, calculateGraphStats } from '@/lib/graph-analysis';
import { TokenSecurityBadge } from './TokenSecurityBadge';

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
}

export function StatsPanel({ data, mode, stats, tokenSecurity }: StatsPanelProps) {
  const graphStats = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const analyzedNodes = analyzeGraph(data.nodes, data.links);
    return calculateGraphStats(analyzedNodes);
  }, [data]);

  if (!data || !stats) return null;

  const cabalFunders = data.nodes.filter(n => n.type === 'cabal-funder');
  const cabalHolders = data.nodes.filter(n => n.type === 'connected' || (n.metadata?.sharedFunderGroup));

  return (
    <div className="glass-panel w-44 sm:w-52 md:w-56 max-h-[40vh] sm:max-h-[60vh] overflow-y-auto themed-scrollbar p-2.5 sm:p-3.5">
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
                <span className="text-xs ml-1" style={{ color: 'var(--text-tertiary)' }}>
                  (max {graphStats.largestComponentSize})
                </span>
              )}
            </span>
          </div>
        )}

        {/* Cabal line */}
        {cabalFunders.length > 0 && (
          <div className="stats-item">
            <span className="stats-label" style={{ color: '#ef4444' }}>Cabal</span>
            <span className="stats-value" style={{ color: '#ef4444' }}>
              {cabalFunders.length} &rarr; {cabalHolders.length}
            </span>
          </div>
        )}

        {/* Snipers */}
        {mode === 'token' && stats.snipersDetected !== undefined && stats.snipersDetected > 0 && (
          <div className="stats-item">
            <span className="stats-label">Snipers</span>
            <span className="stats-value" style={{ color: '#22d3ee' }}>{stats.snipersDetected}</span>
          </div>
        )}

        {/* Bundles */}
        {mode === 'token' && stats.bundleClustersDetected !== undefined && stats.bundleClustersDetected > 0 && (
          <Link href="/blacklist" className="stats-item" style={{ cursor: 'pointer' }}>
            <span className="stats-label" style={{ color: 'var(--purple-primary)' }}>Bundles</span>
            <span className="stats-value" style={{ color: 'var(--purple-primary)' }}>
              {stats.bundleClustersDetected} ({stats.bundledWallets?.length || 0} wallets)
            </span>
          </Link>
        )}
      </div>

      {/* Risk indicator */}
      {mode === 'token' && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-base)' }}>
          <RiskBadge
            cabalCount={cabalFunders.length}
            sniperCount={stats.snipersDetected || 0}
            totalHolders={stats.analyzedHolders || data.nodes.length}
          />
        </div>
      )}

      {/* Clean status for no cabal */}
      {mode === 'token' && cabalFunders.length === 0 && (!stats.cabalConnectionsFound || stats.cabalConnectionsFound === 0) && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-base)' }}>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No shared funders detected</span>
        </div>
      )}

      {stats.analysisIncomplete && (
        <div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
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
      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Risk</span>
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
