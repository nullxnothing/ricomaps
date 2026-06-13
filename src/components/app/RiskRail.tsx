'use client';

import { useState } from 'react';
import type { GraphData, RugScore, SupplyConcentration, TokenSecurityInfo, DeployerInfo } from '@/lib/types';
import { giniLabel } from '@/lib/supply-metrics';
import { RiskGauge } from './RiskGauge';

/**
 * Right rail — risk verdict. Reuses the same computed analysis the old StatsPanel
 * consumed (rug score, supply concentration), re-laid-out to the redesign spec:
 * hero gauge → signal chips → findings → expandable risk callout → holder analysis.
 */
interface RiskRailMeta {
  analyzedHolders?: number;
  totalHolders?: number;
  clusterCount?: number;   // distinct multi-wallet clusters in the graph
  maxClusterSize?: number; // members in the largest cluster
}

interface RiskRailProps {
  data: GraphData;
  rugScore?: RugScore;
  supply?: SupplyConcentration;
  tokenSecurity?: TokenSecurityInfo | null;
  deployer?: DeployerInfo | null;
  meta?: RiskRailMeta;
  className?: string;
}

const BAND = {
  green: { color: 'var(--green-primary)', word: 'LOW RISK' },
  yellow: { color: 'var(--amber-primary)', word: 'CAUTION' },
  red: { color: 'var(--red-primary)', word: 'HIGH RISK' },
} as const;

function pct(n: number | undefined): string {
  return `${(n ?? 0).toFixed(1)}%`;
}

// Severity color for a supply %: greener = safer.
function pctColor(n: number): string {
  if (n >= 20) return 'var(--red-primary)';
  if (n >= 10) return 'var(--amber-primary)';
  return 'var(--green-primary)';
}

export function RiskRail({ data, rugScore, supply, deployer, meta, className }: RiskRailProps) {
  const [factorsOpen, setFactorsOpen] = useState(false);
  const band = rugScore ? BAND[rugScore.level] : BAND.green;
  const findings = rugScore?.factors.slice(0, 3) ?? [];
  const realHolders = supply?.realHolderCount ?? data.nodes.filter(n => n.type !== 'token' && n.type !== 'pool').length;
  const gini = supply ? giniLabel(supply.giniCoefficient) : null;
  const lowCoverage = supply?.analyzedSupplyPct !== undefined && supply.analyzedSupplyPct < 50;

  return (
    <aside className={`rail rail--right ${className ?? ''}`} style={{ width: 336 }} aria-label="Risk analysis">
      {/* Hero card */}
      {rugScore && (
        <div
          className="surface-card flex items-center gap-4 p-4"
          style={{ borderColor: 'rgba(0,255,65,0.18)', boxShadow: '0 0 32px rgba(0,255,65,0.05)' }}
        >
          <RiskGauge score={rugScore.score} color={band.color} />
          <div className="min-w-0">
            <div className="text-[19px] font-extrabold leading-tight" style={{ color: band.color }}>{band.word}</div>
            <div className="text-[11px] text-text-tertiary mt-0.5">Rug score · {rugScore.confidence} confidence</div>
            <div className="text-[11px] text-text-tertiary mt-1 leading-snug">
              Lower is safer. {findings.length === 0 ? 'No critical signals found.' : `${rugScore.factors.length} signal${rugScore.factors.length === 1 ? '' : 's'} detected.`}
            </div>
          </div>
        </div>
      )}

      {/* Signal chips */}
      {supply && (
        <div className="grid grid-cols-3 gap-2">
          <Chip label="Bundled" value={pct(supply.bundledSupplyPct)} color={pctColor(supply.bundledSupplyPct)} />
          <Chip label="Sniped" value={pct(supply.sniperSupplyPct)} color={pctColor(supply.sniperSupplyPct)} />
          <Chip label="Top 10" value={pct(supply.top10Pct)} color={pctColor(supply.top10Pct)} />
        </div>
      )}

      {/* Findings — at-a-glance top signals */}
      {findings.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {findings.map((f, i) => (
            <div key={i} className="flex items-start gap-2 text-[12px] text-text-secondary leading-snug">
              <span className="mt-[5px] w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: severityColor(f.severity) }} />
              {f.label}
            </div>
          ))}
        </div>
      )}

      {/* Expandable risk callout — collapsed summary bar → full factor list */}
      {rugScore && (rugScore.factors.length > 0 || lowCoverage) && (
        <div
          className="rounded-[10px] overflow-hidden"
          style={{ background: `${band.color}0d`, border: `1px solid ${band.color}38` }}
        >
          <button
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
            onClick={() => setFactorsOpen(o => !o)}
            aria-expanded={factorsOpen}
          >
            <span className="flex items-center gap-2 min-w-0">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={band.color} strokeWidth="2" className="flex-shrink-0">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-bold tracking-[0.04em]" style={{ color: band.color }}>{band.word}</span>
                <span className="block text-[10px] text-text-tertiary truncate">
                  {rugScore.factors.length} factor{rugScore.factors.length === 1 ? '' : 's'}{lowCoverage ? ' · low supply visibility' : ''}
                </span>
              </span>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="flex-shrink-0 text-text-tertiary transition-transform" style={{ transform: factorsOpen ? 'rotate(180deg)' : 'none' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {factorsOpen && (
            <div className="px-3 pb-3 pt-0.5 flex flex-col gap-2">
              {rugScore.factors.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-[11.5px] text-text-secondary leading-snug">
                  <span className="mt-[5px] w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: severityColor(f.severity) }} />
                  {f.label}
                </div>
              ))}
              {(rugScore.coverageNote || lowCoverage) && (
                <div className="text-[10.5px] leading-snug text-text-tertiary mt-0.5">
                  {rugScore.coverageNote ??
                    `Top ${realHolders} holders = ${pct(supply?.analyzedSupplyPct)} of supply (rest in pool / untracked). Percentages are of total supply held.`}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Holder analysis */}
      {supply && (
        <div>
          <div className="section-label mb-2">Holder Analysis</div>
          <Row
            k="Insiders hold"
            v={
              supply.insiderEntrySupplyPct > 0 && supply.insiderEntrySupplyPct > supply.insiderStillHoldingPct
                ? `${pct(supply.insiderEntrySupplyPct)} → ${pct(supply.insiderStillHoldingPct)}`
                : pct(supply.insiderStillHoldingPct)
            }
            color={pctColor(supply.insiderStillHoldingPct)}
          />
          {gini && (
            <Row
              k={lowCoverage ? 'Spread (top)' : 'Spread'}
              v={`${gini} (${supply.giniCoefficient.toFixed(2)})`}
              color={gini === 'Extreme' ? 'var(--red-primary)' : gini === 'Concentrated' ? 'var(--amber-primary)' : 'var(--green-primary)'}
            />
          )}
          {supply.freshWalletPct > 0 && <Row k="Fresh wallets" v={pct(supply.freshWalletPct)} />}
          <Row k="Real holders" v={String(realHolders)} />
          {supply.analyzedSupplyPct !== undefined && (
            <Row k="Supply covered" v={pct(supply.analyzedSupplyPct)} color={lowCoverage ? 'var(--amber-primary)' : 'var(--green-primary)'} />
          )}
          {deployer?.heldSupplyPct != null && (
            <Row k="Deployer holds" v={pct(deployer.heldSupplyPct)} color={pctColor(deployer.heldSupplyPct)} />
          )}
          {meta?.analyzedHolders != null && meta?.totalHolders != null && (
            <Row k="Holders" v={`${meta.analyzedHolders} / ${meta.totalHolders}`} />
          )}
          {meta?.clusterCount != null && meta.clusterCount > 0 && (
            <Row k="Clusters" v={meta.maxClusterSize && meta.maxClusterSize > 1 ? `${meta.clusterCount} (max ${meta.maxClusterSize})` : String(meta.clusterCount)} />
          )}
        </div>
      )}
    </aside>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="signal-chip">
      <span className="val" style={{ color }}>{value}</span>
      <span className="lbl">{label}</span>
    </div>
  );
}

function Row({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-val" style={color ? { color } : undefined}>{v}</span>
    </div>
  );
}

function severityColor(s: 'critical' | 'high' | 'medium' | 'low'): string {
  if (s === 'critical' || s === 'high') return 'var(--red-primary)';
  if (s === 'medium') return 'var(--amber-primary)';
  return 'var(--green-primary)';
}

export default RiskRail;
