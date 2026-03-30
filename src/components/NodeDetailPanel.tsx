'use client';

import { useState, useEffect } from 'react';
import { GraphNode } from '@/lib/types';
import { truncateAddress } from '@/lib/address-utils';
import { CATEGORY_INFO, WalletCategory } from '@/lib/wallet-labels';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
  onExpandFunding?: () => void;
  onExpandFunded?: () => void;
  isLoading?: boolean;
}

const typeConfig: Record<string, { label: string; cssColor: string }> = {
  target: { label: 'Target', cssColor: 'var(--green-primary)' },
  funder: { label: 'Funder', cssColor: 'var(--blue-primary)' },
  funded: { label: 'Funded', cssColor: '#8b8bff' },
  holder: { label: 'Holder', cssColor: 'var(--text-secondary)' },
  token: { label: 'Token', cssColor: 'var(--amber-primary)' },
  'cabal-funder': { label: 'Cabal funder', cssColor: 'var(--red-primary)' },
  connected: { label: 'Cabal linked', cssColor: 'var(--amber-primary)' },
  sniper: { label: 'Sniper', cssColor: 'var(--cyan-primary)' },
  bundled: { label: 'Bundled', cssColor: '#a78bfa' },
};

function formatAmount(amount: number): string {
  if (amount >= 1e9) return (amount / 1e9).toFixed(2) + 'B';
  if (amount >= 1e6) return (amount / 1e6).toFixed(2) + 'M';
  if (amount >= 1e3) return (amount / 1e3).toFixed(2) + 'K';
  if (amount < 0.01) return amount.toFixed(6);
  return amount.toFixed(2);
}

export function NodeDetailPanel({
  node,
  onClose,
  onExpandFunding,
  onExpandFunded,
  isLoading
}: NodeDetailPanelProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  if (!node) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(node.id);
    setCopied(true);
  };

  const config = typeConfig[node.type] || { label: node.type, cssColor: 'var(--text-tertiary)' };
  const walletLabel = node.identity?.name || node.walletLabel?.name;
  const categoryInfo = node.walletLabel ? CATEGORY_INFO[node.walletLabel.category as WalletCategory] : null;

  return (
    <div className="glass-panel w-full sm:w-72 sm:rounded-lg rounded-none rounded-t-xl max-h-[50vh] sm:max-h-none overflow-y-auto themed-scrollbar">
      {/* Header: type badge + close */}
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: config.cssColor }}
          />
          <span className="text-xs font-medium" style={{ color: config.cssColor }}>
            {config.label}
          </span>
          {node.metadata?.cabalConfidence && (
            <span className="badge-danger text-[10px]">{node.metadata.cabalConfidence}%</span>
          )}
        </div>
        <button onClick={onClose} className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Known identity */}
      {walletLabel && (
        <div className="px-3.5 py-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
          <span className="text-sm font-medium" style={{ color: categoryInfo?.color || 'var(--text-primary)' }}>
            {walletLabel}
          </span>
          {node.walletLabel?.verified && (
            <span className="badge-success ml-2 text-[10px]">verified</span>
          )}
        </div>
      )}

      {/* Address */}
      <div className="flex items-center justify-between px-3.5 py-2 border-t" style={{ borderColor: 'var(--border-base)' }}>
        <code className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{truncateAddress(node.id, 8)}</code>
        <button
          onClick={handleCopy}
          className="p-1 rounded transition-colors text-xs"
          style={{
            color: copied ? 'var(--green-primary)' : 'var(--text-tertiary)',
          }}
          title="Copy address"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
          )}
        </button>
      </div>

      {/* Key data rows */}
      <div className="border-t px-3.5 py-2 space-y-1.5" style={{ borderColor: 'var(--border-base)' }}>
        {node.solBalance !== undefined && (
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--text-tertiary)' }}>Balance</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{formatAmount(node.solBalance)} SOL</span>
          </div>
        )}
        {node.tokenAmount !== undefined && (
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--text-tertiary)' }}>Holdings</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{formatAmount(node.tokenAmount)}</span>
          </div>
        )}
        {node.metadata?.fundedCount && node.metadata.fundedCount > 1 && (
          <div className="flex justify-between text-xs">
            <span style={{ color: 'var(--red-primary)' }}>Funded holders</span>
            <span className="font-mono font-semibold" style={{ color: 'var(--red-primary)' }}>{node.metadata.fundedCount}</span>
          </div>
        )}
      </div>

      {/* Funding source */}
      {node.fundingSource && (
        <div className="border-t px-3.5 py-2" style={{ borderColor: 'var(--border-base)' }}>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-tertiary)' }}>Funded by</span>
            <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>
              {node.fundingSource.funderName || truncateAddress(node.fundingSource.funderAddress, 4)}
            </span>
          </div>
        </div>
      )}

      {/* Sniper info */}
      {node.metadata?.isSniper && node.metadata.blocksAfterLaunch !== undefined && (
        <div className="border-t px-3.5 py-2" style={{ borderColor: 'var(--border-base)' }}>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--cyan-primary)' }}>Bought after launch</span>
            <span className="font-mono" style={{ color: 'var(--cyan-primary)' }}>
              {Math.abs(node.metadata.blocksAfterLaunch)} blocks
            </span>
          </div>
        </div>
      )}

      {/* Cabal cluster */}
      {node.metadata?.sharedFunderGroup && (
        <div className="border-t px-3.5 py-2" style={{ borderColor: 'var(--border-base)' }}>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-tertiary)' }}>Cabal cluster</span>
            <span className="font-mono text-[11px]" style={{ color: 'var(--red-primary)' }}>
              {node.metadata.sharedFunderGroup}
            </span>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 px-3.5 py-2 border-t text-xs" style={{ borderColor: 'var(--border-base)', color: 'var(--text-tertiary)' }}>
          <div className="spinner" />
          <span>Loading...</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 border-t" style={{ borderColor: 'var(--border-base)' }}>
        {node.type !== 'token' && (
          <>
            {!node.expanded && onExpandFunding && (
              <button onClick={onExpandFunding} className="node-action-btn">
                Trace funders
              </button>
            )}
            {onExpandFunded && (
              <button onClick={onExpandFunded} className="node-action-btn secondary">
                Show funded
              </button>
            )}
          </>
        )}

        <a
          href={`https://solscan.io/account/${node.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="node-action-btn external"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
          </svg>
          Solscan
        </a>
      </div>
    </div>
  );
}

export default NodeDetailPanel;
