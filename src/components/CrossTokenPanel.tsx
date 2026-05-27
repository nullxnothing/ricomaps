'use client';

import { useState, useEffect, useCallback } from 'react';
import { CrossTokenResult, SharedToken } from '@/lib/cross-token-analyzer';

interface CrossTokenPanelProps {
  isOpen: boolean;
  onClose: () => void;
  cabalWallets: string[];
}

const CREDITS_PER_WALLET = 100;

function truncateAddr(addr: string, chars = 4): string {
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

function formatBalance(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(4);
}

function formatUsd(value: number): string {
  if (value < 0.01) return '<$0.01';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function TokenRow({ token, totalWallets }: { token: SharedToken; totalWallets: number }) {
  const [expanded, setExpanded] = useState(false);
  const combinedBalance = token.holders.reduce((sum, h) => sum + h.balance, 0);
  const combinedUsd = token.holders.reduce((sum, h) => sum + h.usdValue, 0);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-base)' }}
    >
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
        style={{ background: 'transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        onClick={() => setExpanded(!expanded)}
      >
        {token.image ? (
          <img
            src={token.image.startsWith('https://') ? token.image : ''}
            alt=""
            className="w-7 h-7 rounded-full flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
            ?
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {token.name}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>${token.symbol}</span>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>
              Held by <span style={{ color: 'var(--red-primary)' }}>{token.holderCount}</span>/{totalWallets} cabal wallets
            </span>
            <span style={{ color: 'var(--border-base)' }}>|</span>
            <span>
              Combined: {formatBalance(combinedBalance)}
              {combinedUsd > 0 && ` (${formatUsd(combinedUsd)})`}
            </span>
          </div>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="flex-shrink-0 transition-transform"
          style={{ color: 'var(--text-tertiary)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-1" style={{ borderTop: '1px solid var(--bg-hover)' }}>
          {token.holders.map((holder) => (
            <div
              key={holder.address}
              className="flex items-center justify-between py-1.5 px-2 rounded text-xs"
              style={{ background: 'rgba(255,255,255,0.015)' }}
            >
              <a
                href={`https://orbmarkets.io/address/${holder.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono hover:underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                {truncateAddr(holder.address, 6)}
              </a>
              <div className="flex items-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
                <span>{formatBalance(holder.balance)}</span>
                {holder.usdValue > 0 && (
                  <span style={{ color: 'var(--green-primary)' }}>{formatUsd(holder.usdValue)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CrossTokenPanel({ isOpen, onClose, cabalWallets }: CrossTokenPanelProps) {
  const [data, setData] = useState<CrossTokenResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (cabalWallets.length === 0) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/cross-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets: cabalWallets }),
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Analysis failed');
      }

      setData({
        sharedTokens: json.sharedTokens,
        totalWalletsAnalyzed: json.totalWalletsAnalyzed,
        analysisTimestamp: json.analysisTimestamp,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsLoading(false);
    }
  }, [cabalWallets]);

  useEffect(() => {
    if (isOpen && !data && !isLoading) {
      fetchData();
    }
  }, [isOpen, data, isLoading, fetchData]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setData(null);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const estimatedCredits = cabalWallets.length * CREDITS_PER_WALLET;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg xl:max-w-xl 2xl:max-w-2xl max-h-[80vh] mx-4 rounded-xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-base)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-base)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Cross-Token Cabal Analysis
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Analyzed {cabalWallets.length} cabal wallets
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto themed-scrollbar px-4 py-3 space-y-2">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="spinner-lg" />
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Scanning {cabalWallets.length} wallets for shared holdings...
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}>
                Estimated cost: ~{estimatedCredits} credits
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg p-3" style={{ background: 'var(--red-ghost)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-sm" style={{ color: 'var(--red-primary)' }}>{error}</p>
            </div>
          )}

          {data && data.sharedTokens.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No shared token holdings found</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                None of the cabal wallets hold 3+ tokens in common.
              </p>
            </div>
          )}

          {data && data.sharedTokens.length > 0 && (
            <>
              <div className="flex items-center gap-2 pb-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Shared Holdings ({data.sharedTokens.length} tokens)
                </span>
              </div>
              {data.sharedTokens.map((token) => (
                <TokenRow
                  key={token.mint}
                  token={token}
                  totalWallets={data.totalWalletsAnalyzed}
                />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5" style={{ borderTop: '1px solid var(--border-base)' }}>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}>
            This scan used ~{estimatedCredits} credits
          </p>
        </div>
      </div>
    </div>
  );
}

export default CrossTokenPanel;
