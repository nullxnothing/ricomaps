'use client';

import { useState } from 'react';
import { TokenSecurityInfo } from '@/lib/types';

interface TokenSecurityBadgeProps {
  security: TokenSecurityInfo | null;
  compact?: boolean;
}

export function TokenSecurityBadge({ security, compact = false }: TokenSecurityBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  if (!security) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-base)' }}
      >
        <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--blue-primary)', borderTopColor: 'transparent' }} />
        <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>ANALYZING...</span>
      </div>
    );
  }

  const riskConfig = {
    low: {
      color: 'var(--green-primary)',
      bg: 'var(--green-ghost)',
      border: 'rgba(0, 255, 65, 0.2)',
      icon: '\u2713',
      label: 'LOW RISK',
    },
    medium: {
      color: 'var(--amber-primary)',
      bg: 'var(--amber-ghost)',
      border: 'rgba(245, 158, 11, 0.3)',
      icon: '\u26A0',
      label: 'MEDIUM RISK',
    },
    high: {
      color: 'var(--red-primary)',
      bg: 'var(--red-ghost)',
      border: 'rgba(239, 68, 68, 0.3)',
      icon: '\u26A0',
      label: 'HIGH RISK',
    },
    critical: {
      color: 'var(--red-primary)',
      bg: 'var(--red-ghost)',
      border: 'rgba(239, 68, 68, 0.5)',
      icon: '\u2715',
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
        className="w-full flex items-center justify-between gap-2 px-3 py-2 transition-colors overflow-hidden"
        style={{ background: 'transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base flex-shrink-0" style={{ color: config.color }}>{config.icon}</span>
          <div className="text-left min-w-0">
            <div className="text-xs font-mono font-bold truncate" style={{ color: config.color }}>
              {config.label}
            </div>
            <div className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
              {security.riskFactors.length} factor{security.riskFactors.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Risk meter */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-auto overflow-hidden">
          <div className="w-12 sm:w-16 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--bg-elevated)' }}>
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
            className={`w-4 h-4 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
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
            <div className="pt-2" style={{ borderTop: '1px solid var(--border-base)' }}>
              {security.riskFactors.map((factor, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-[10px] py-0.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span style={{ color: 'var(--amber-primary)' }} className="mt-0.5">&bull;</span>
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
          <svg className="w-3.5 h-3.5" style={{ color: 'var(--green-primary)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" style={{ color: 'var(--amber-primary)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M12 9v4m0 4h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}
        <span style={{ color: safe ? 'var(--text-secondary)' : 'var(--amber-primary)' }}>{label}</span>
      </div>
      <span className="font-mono" style={{ color: safe ? 'var(--green-primary)' : 'var(--amber-primary)' }}>
        {detail}
      </span>
    </div>
  );
}

export default TokenSecurityBadge;
