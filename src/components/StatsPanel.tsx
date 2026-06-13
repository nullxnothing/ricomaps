'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { GraphData, AppMode, TokenSecurityInfo, SupplyConcentration, RugScore, DeployerInfo, CabalFingerprintResult } from '@/lib/types';
import { analyzeGraph, calculateGraphStats } from '@/lib/graph-analysis';
import { giniLabel } from '@/lib/supply-metrics';
import { TokenSecurityBadge } from './TokenSecurityBadge';
import { DeployerCard } from './DeployerCard';
import { CabalRapSheet } from './CabalRapSheet';
import { BorderBeam } from './ui/border-beam';

export type StatsFilter = 'cabal' | 'snipers' | 'bundles' | 'behavioral' | null;

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
    behavioralClustersDetected?: number;
    behaviorallyClusteredWallets?: string[];
    supplyConcentration?: SupplyConcentration;
    rugScore?: RugScore;
    cabalFingerprint?: CabalFingerprintResult;
  };
  tokenSecurity?: TokenSecurityInfo | null;
  deployerInfo?: DeployerInfo | null;
  streaming?: {
    isStreaming: boolean;
    transactionCount: number;
  };
  onFilter?: (filter: StatsFilter) => void;
  activeFilter?: StatsFilter;
  onTokenScan?: (mint: string) => void;
}

export function StatsPanel({ data, mode, stats, tokenSecurity, deployerInfo, onFilter, activeFilter = null, onTokenScan }: StatsPanelProps) {
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
      {/* Rug verdict: the 5-second entry signal */}
      {mode === 'token' && stats.rugScore && (
        <RugScoreHeadline rug={stats.rugScore} />
      )}

      {/* Security badge (compact) */}
      {mode === 'token' && (
        <div className="mb-3">
          <TokenSecurityBadge security={tokenSecurity || null} />
        </div>
      )}

      {/* Supply concentration: the headline metric traders screenshot */}
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

        {/* Rap sheet: this crew's prior tokens (matched by funding fingerprint) */}
        {mode === 'token' && stats.cabalFingerprint && stats.cabalFingerprint.matches.length > 0 && (
          <CabalRapSheet fingerprint={stats.cabalFingerprint} onTokenScan={onTokenScan} />
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

        {/* Behavioral clusters: funding-independent crews */}
        {mode === 'token' && stats.behavioralClustersDetected !== undefined && stats.behavioralClustersDetected > 0 && (
          <button
            type="button"
            className="stats-item-btn relative"
            onClick={() => onFilter?.(activeFilter === 'behavioral' ? null : 'behavioral')}
            aria-pressed={activeFilter === 'behavioral'}
            title="Filter to behaviorally-clustered wallets (funding-independent)"
          >
            <span className="stats-label" style={{ color: 'var(--amber-primary)' }}>Behavioral</span>
            <span className="stats-value" style={{ color: 'var(--amber-primary)' }}>
              {stats.behavioralClustersDetected} ({stats.behaviorallyClusteredWallets?.length || 0} wallets)
            </span>
            {activeFilter === 'behavioral' && (
              <BorderBeam size={45} duration={4} colorFrom="#f59e0b" colorTo="#fcd34d" />
            )}
          </button>
        )}
      </div>

      {/* Deployer / dev intel */}
      {mode === 'token' && deployerInfo && (
        <DeployerCard deployer={deployerInfo} />
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
  // top holders", not token-wide; say so instead of implying false safety.
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
          : `% of circulating supply held${sc.supplyDenominatorSource === 'sum' ? ' (est.: mint supply unavailable)' : ''}.`}
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

const RUG_LEVEL_STYLE = {
  green:  { color: 'var(--green-primary)', bg: 'var(--green-ghost)', label: 'LOW RISK' },
  yellow: { color: 'var(--amber-primary)', bg: 'var(--amber-ghost)', label: 'CAUTION' },
  red:    { color: 'var(--red-primary)',   bg: 'var(--red-ghost)',   label: 'HIGH RISK' },
} as const;

function RugScoreHeadline({ rug }: { rug: RugScore }) {
  const s = RUG_LEVEL_STYLE[rug.level];
  const topFactors = rug.factors.slice(0, 3);

  return (
    <div className="mb-3 pb-3 border-b border-border-base">
      <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2" style={{ background: s.bg }}>
        <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: s.color }}>{rug.score}</span>
        <div className="flex flex-col">
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: s.color }}>{s.label}</span>
          <span className="text-[10px] text-text-tertiary">Rug score · {rug.confidence} confidence</span>
        </div>
      </div>

      {topFactors.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {topFactors.map((f, i) => (
            <li key={i} className="flex items-start gap-1 text-[10px] leading-tight text-text-secondary">
              <span style={{ color: severityColor(f.severity) }}>▰</span>
              {f.label}
            </li>
          ))}
        </ul>
      )}

      {rug.coverageNote && (
        <p className="mt-1 text-[10px] leading-tight text-text-tertiary">{rug.coverageNote}</p>
      )}
    </div>
  );
}

function severityColor(severity: RugScore['factors'][number]['severity']): string {
  if (severity === 'critical' || severity === 'high') return 'var(--red-primary)';
  if (severity === 'medium') return 'var(--amber-primary)';
  return 'var(--text-tertiary)';
}

export default StatsPanel;
