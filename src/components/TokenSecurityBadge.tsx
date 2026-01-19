'use client';

import { useState } from 'react';
import { TokenSecurityInfo } from '@/lib/types';

interface TokenSecurityBadgeProps {
  security: TokenSecurityInfo | null;
  compact?: boolean;
}

export function TokenSecurityBadge({ security, compact = false }: TokenSecurityBadgeProps) {
  const [expanded, setExpanded] = useState(true); // Default expanded

  if (!security) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded bg-[#1a1a24] border border-[#2a2a3a]">
        <div className="w-4 h-4 border-2 border-[#4a9eff] border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-[#6b7280] font-mono">ANALYZING...</span>
      </div>
    );
  }

  const riskConfig = {
    low: {
      color: '#22c55e',
      bg: 'rgba(34, 197, 94, 0.1)',
      border: 'rgba(34, 197, 94, 0.3)',
      icon: '✓',
      label: 'LOW RISK',
    },
    medium: {
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.1)',
      border: 'rgba(245, 158, 11, 0.3)',
      icon: '⚠',
      label: 'MEDIUM RISK',
    },
    high: {
      color: '#f97316',
      bg: 'rgba(249, 115, 22, 0.1)',
      border: 'rgba(249, 115, 22, 0.4)',
      icon: '⚠',
      label: 'HIGH RISK',
    },
    critical: {
      color: '#ef4444',
      bg: 'rgba(239, 68, 68, 0.15)',
      border: 'rgba(239, 68, 68, 0.5)',
      icon: '✕',
      label: 'CRITICAL',
    },
  };

  const config = riskConfig[security.riskLevel];

  if (compact) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-bold border"
        style={{
          background: config.bg,
          borderColor: config.border,
          color: config.color,
        }}
        title={security.riskFactors.join('\n')}
      >
        <span>{config.icon}</span>
        <span>{config.label}</span>
      </div>
    );
  }

  return (
    <div
      className="rounded border overflow-hidden"
      style={{
        background: config.bg,
        borderColor: config.border,
      }}
    >
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-base" style={{ color: config.color }}>{config.icon}</span>
          <div className="text-left">
            <div className="text-xs font-mono font-bold" style={{ color: config.color }}>
              {config.label}
            </div>
            <div className="text-[10px] text-[#6b7280]">
              {security.riskFactors.length} risk factor{security.riskFactors.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Risk meter */}
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-[#1a1a24] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: security.riskLevel === 'low' ? '25%' :
                       security.riskLevel === 'medium' ? '50%' :
                       security.riskLevel === 'high' ? '75%' : '100%',
                background: config.color,
              }}
            />
          </div>
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            style={{ color: config.color }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Security checks */}
          <div className="space-y-1.5">
            <SecurityCheck
              label="Freeze Authority"
              safe={!security.hasFreezeAuthority}
              detail={security.hasFreezeAuthority ? 'Enabled' : 'Disabled'}
            />
            <SecurityCheck
              label="Mint Authority"
              safe={!security.hasMintAuthority}
              detail={security.hasMintAuthority ? 'Enabled' : 'Disabled'}
            />
            <SecurityCheck
              label="Metadata"
              safe={!security.isMutable}
              detail={security.isMutable ? 'Mutable' : 'Immutable'}
            />
          </div>

          {/* Risk factors */}
          {security.riskFactors.length > 0 && (
            <div className="pt-2 border-t border-[#2a2a3a]">
              {security.riskFactors.map((factor, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-[10px] text-[#9898a6] py-0.5"
                >
                  <span className="text-[#f59e0b] mt-0.5">•</span>
                  <span>{factor}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SecurityCheck({
  label,
  safe,
  detail,
}: {
  label: string;
  safe: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <div className="flex items-center gap-2">
        {safe ? (
          <svg className="w-3.5 h-3.5 text-[#22c55e]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-[#f59e0b]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M12 9v4m0 4h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}
        <span className={safe ? 'text-[#9898a6]' : 'text-[#f59e0b]'}>{label}</span>
      </div>
      <span className={`font-mono ${safe ? 'text-[#22c55e]' : 'text-[#f59e0b]'}`}>
        {detail}
      </span>
    </div>
  );
}

export default TokenSecurityBadge;
