'use client';

import { useState } from 'react';
import { BundleCluster } from '@/lib/types';
import { truncateAddress } from '@/lib/address-utils';
import { timeAgo } from '@/lib/format';

interface ClusterCardProps {
  cluster: BundleCluster;
  onWalletClick?: (address: string) => void;
  onTokenScan?: (mint: string) => void;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = confidence >= 80 ? 'high' : confidence >= 60 ? 'medium' : 'low';
  const colorMap = {
    high: 'var(--red-primary)',
    medium: 'var(--amber-primary)',
    low: 'var(--purple-primary)',
  };
  const bgMap = {
    high: 'var(--red-ghost)',
    medium: 'var(--amber-ghost)',
    low: 'var(--purple-ghost)',
  };

  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded"
      style={{ color: colorMap[level], background: bgMap[level] }}
    >
      {confidence}%
    </span>
  );
}

export function ClusterCard({ cluster, onWalletClick, onTokenScan }: ClusterCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="cluster-card">
      {/* Collapsed header — always visible */}
      <button
        className="w-full flex items-center justify-between gap-3 text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0"
            style={{ background: 'var(--purple-ghost)', color: 'var(--purple-primary)' }}
          >
            {cluster.wallets.length} wallets
          </span>
          <span className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
            {cluster.tokens.map(t => t.tokenSymbol || truncateAddress(t.mint, 3)).join(', ')}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {cluster.totalAppearances} token{cluster.totalAppearances !== 1 ? 's' : ''}
          </span>
          <ConfidenceBadge confidence={cluster.confidence} />
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {timeAgo(cluster.lastSeenTimestamp, true)}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ color: 'var(--text-tertiary)', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-3 pt-3 space-y-3" style={{ borderTop: '1px solid var(--border-base)' }}>
          {/* Wallets */}
          <div>
            <span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Wallets</span>
            <div className="flex flex-wrap gap-1.5">
              {cluster.wallets.map(wallet => (
                <button
                  key={wallet}
                  className="wallet-pill"
                  onClick={(e) => { e.stopPropagation(); onWalletClick?.(wallet); }}
                  title={wallet}
                >
                  {truncateAddress(wallet, 4)}
                </button>
              ))}
            </div>
          </div>

          {/* Shared funder */}
          {cluster.sharedFunder && (
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--red-primary)' }}>Shared Funder:</span>
              <button
                className="wallet-pill"
                onClick={(e) => { e.stopPropagation(); onWalletClick?.(cluster.sharedFunder!); }}
                title={cluster.sharedFunder}
              >
                {truncateAddress(cluster.sharedFunder, 4)}
              </button>
            </div>
          )}

          {/* Tokens detected on */}
          <div>
            <span className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Tokens</span>
            <div className="space-y-1">
              {cluster.tokens.map((token, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span style={{ color: 'var(--text-primary)' }}>
                      {token.tokenSymbol ? `$${token.tokenSymbol}` : truncateAddress(token.mint, 4)}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      slot {token.slot.toLocaleString()}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      {token.walletCount} bundled
                    </span>
                  </div>
                  <button
                    className="btn-ghost text-xs py-0.5 px-2"
                    onClick={(e) => { e.stopPropagation(); onTokenScan?.(token.mint); }}
                  >
                    Scan
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Cluster ID */}
          <div className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
            ID: {cluster.id}
          </div>
        </div>
      )}
    </div>
  );
}
