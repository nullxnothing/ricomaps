'use client';

import { useMemo } from 'react';
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
    analyzedHolders?: number;
    cabalConnectionsFound?: number;
    suspiciousWallets?: string[];
    dexFundedHolders?: number;
    freshWalletFunders?: number;
  };
  tokenSecurity?: TokenSecurityInfo | null;
  streaming?: {
    isStreaming: boolean;
    transactionCount: number;
  };
}

export function StatsPanel({ data, mode, stats, tokenSecurity, streaming }: StatsPanelProps) {
  // Analyze graph for cluster statistics - must be before any early returns
  const graphStats = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const analyzedNodes = analyzeGraph(data.nodes, data.links);
    return calculateGraphStats(analyzedNodes);
  }, [data]);

  if (!data || !stats) return null;

  const cabalFunders = data.nodes.filter(n => n.type === 'cabal-funder');

  return (
    <div className="card w-64">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[#e34946]">
          Scan Results
        </h3>
        {streaming?.isStreaming && (
          <div className="flex items-center gap-1 text-xs text-[#22c55e]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e]" />
            </span>
            Live
          </div>
        )}
      </div>

      {/* Token Security Badge - prominently displayed for token mode */}
      {mode === 'token' && (
        <div className="mb-4">
          <TokenSecurityBadge security={tokenSecurity || null} />
        </div>
      )}

      <div className="space-y-1">
        <div className="stats-item">
          <span className="stats-label">Nodes</span>
          <span className="stats-value">{data.nodes.length}</span>
        </div>
        <div className="stats-item">
          <span className="stats-label">Connections</span>
          <span className="stats-value">{data.links.length}</span>
        </div>

        {mode === 'wallet' && stats.scanDepth && (
          <div className="stats-item">
            <span className="stats-label">Scan Depth</span>
            <span className="stats-value">{stats.scanDepth}</span>
          </div>
        )}

        {mode === 'token' && (
          <>
            {stats.totalHolders && (
              <div className="stats-item">
                <span className="stats-label">Total Holders</span>
                <span className="stats-value">{stats.totalHolders.toLocaleString()}</span>
              </div>
            )}
            {stats.analyzedHolders && (
              <div className="stats-item">
                <span className="stats-label">Analyzed</span>
                <span className="stats-value">{stats.analyzedHolders}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Cluster Statistics Section */}
      {graphStats && (
        <div className="mt-4 pt-3 border-t border-[#2a2a3a]">
          <h4 className="text-xs font-bold text-[#9898a6] mb-2">
            Cluster Analysis
          </h4>
          <div className="space-y-1">
            <div className="stats-item">
              <span className="stats-label">Isolated Wallets</span>
              <span className="text-[#4a5568]">{graphStats.isolatedNodes}</span>
            </div>
            <div className="stats-item">
              <span className="stats-label">Clustered Wallets</span>
              <span className="text-[#64b5f6]">{graphStats.clusteredNodes}</span>
            </div>
            <div className="stats-item">
              <span className="stats-label">Hub Wallets</span>
              <span className="text-[#ff6b6b]">{graphStats.hubNodes}</span>
            </div>
            {graphStats.cabalNodes > 0 && (
              <div className="stats-item">
                <span className="stats-label">Cabal Nodes</span>
                <span className="text-[#ff3366] font-bold">{graphStats.cabalNodes}</span>
              </div>
            )}
            <div className="stats-item">
              <span className="stats-label">Clusters Found</span>
              <span className="stats-value">{graphStats.componentCount}</span>
            </div>
            {graphStats.largestComponentSize > 1 && (
              <div className="stats-item">
                <span className="stats-label">Largest Cluster</span>
                <span className="stats-value">{graphStats.largestComponentSize} wallets</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Node Type Breakdown - Token Mode */}
      {mode === 'token' && data.nodes.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[#2a2a3a]">
          <h4 className="text-xs font-bold text-[#9898a6] mb-2">
            Node Breakdown
          </h4>
          <div className="space-y-1">
            {(() => {
              const counts = data.nodes.reduce((acc, n) => {
                acc[n.type] = (acc[n.type] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);
              return (
                <>
                  {counts['token'] && (
                    <div className="stats-item">
                      <span className="stats-label flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#ffd54f]" />
                        Token
                      </span>
                      <span className="text-[#ffd54f]">{counts['token']}</span>
                    </div>
                  )}
                  {counts['holder'] && (
                    <div className="stats-item">
                      <span className="stats-label flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#5a7a9a]" />
                        Holders
                      </span>
                      <span className="text-[#5a7a9a]">{counts['holder']}</span>
                    </div>
                  )}
                  {counts['connected'] && (
                    <div className="stats-item">
                      <span className="stats-label flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#ff9f43]" />
                        Connected
                      </span>
                      <span className="text-[#ff9f43]">{counts['connected']}</span>
                    </div>
                  )}
                  {counts['cabal-funder'] && (
                    <div className="stats-item">
                      <span className="stats-label flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#ff3366]" />
                        Cabal Funders
                      </span>
                      <span className="text-[#ff3366] font-bold">{counts['cabal-funder']}</span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Cabal Detection Section */}
      {(cabalFunders.length > 0 || (stats.cabalConnectionsFound && stats.cabalConnectionsFound > 0)) && (
        <div className="mt-4 pt-3 border-t border-[#2a2a3a]">
          <h4 className="text-xs font-bold text-[#ff3366] mb-2">
            ⚠ Cabal Detected
          </h4>
          <div className="space-y-1">
            <div className="stats-item">
              <span className="stats-label">Shared Funders</span>
              <span className="text-[#ff3366] font-bold">{cabalFunders.length}</span>
            </div>
            {stats.cabalConnectionsFound && (
              <div className="stats-item">
                <span className="stats-label">Cabal Links</span>
                <span className="text-[#ff3366] font-bold">{stats.cabalConnectionsFound}</span>
              </div>
            )}
            {stats.dexFundedHolders !== undefined && stats.dexFundedHolders > 0 && (
              <div className="stats-item">
                <span className="stats-label">DEX Funded</span>
                <span className="text-[#f59e0b] font-bold">{stats.dexFundedHolders}</span>
              </div>
            )}
            {stats.freshWalletFunders !== undefined && stats.freshWalletFunders > 0 && (
              <div className="stats-item">
                <span className="stats-label">Fresh Wallets</span>
                <span className="text-[#f59e0b] font-bold">{stats.freshWalletFunders}</span>
              </div>
            )}
          </div>

          {/* Top Cabal Funders with funded counts */}
          {cabalFunders.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-[#9898a6] mb-1">Top Cabal Funders:</p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {cabalFunders
                  .sort((a, b) => (b.metadata?.fundedCount || 0) - (a.metadata?.fundedCount || 0))
                  .slice(0, 6)
                  .map((funder, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] bg-[#1a1a2e] rounded px-2 py-1">
                      <span className="font-mono text-[#ff6b6b] truncate max-w-[120px]">
                        {funder.id.slice(0, 8)}...{funder.id.slice(-4)}
                      </span>
                      <span className="text-[#ff3366] font-bold ml-2">
                        →{funder.metadata?.fundedCount || '?'}
                      </span>
                    </div>
                  ))}
                {cabalFunders.length > 6 && (
                  <div className="text-[10px] text-[#5a5a6e] text-center">
                    +{cabalFunders.length - 6} more funders
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* No Cabal Found */}
      {mode === 'token' && cabalFunders.length === 0 && (!stats.cabalConnectionsFound || stats.cabalConnectionsFound === 0) && (
        <div className="mt-4 pt-3 border-t border-[#2a2a3a]">
          <div className="text-xs text-[#64b5f6]">
            No shared funders detected
          </div>
        </div>
      )}

      {/* Streaming Stats */}
      {streaming?.isStreaming && streaming.transactionCount > 0 && (
        <div className="mt-4 pt-3 border-t border-[#2a2a3a]">
          <h4 className="text-xs font-bold text-[#22c55e] mb-2">
            Real-Time Updates
          </h4>
          <div className="stats-item">
            <span className="stats-label">New Transactions</span>
            <span className="text-[#22c55e]">{streaming.transactionCount}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-[#2a2a3a]">
        <h4 className="text-xs font-bold text-[#9898a6] mb-2">Legend</h4>
        <div className="space-y-1 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#e34946]" />
            <span>Target</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#64b5f6]" />
            <span>Funder / Holder</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#ce93d8]" />
            <span>Funded</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#ff6b6b]" />
            <span>Hub (4+ connections)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#ff3366]" />
            <span>Cabal Funder</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#4a5568]" />
            <span>Isolated / Unlinked</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StatsPanel;
