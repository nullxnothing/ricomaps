'use client';

import { useState, useEffect } from 'react';
import { GraphNode, WalletProfile } from '@/lib/types';
import { truncateAddress } from '@/lib/address-utils';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  walletProfile?: WalletProfile | null;
  onClose: () => void;
  onExpandFunding?: () => void;
  onExpandFunded?: () => void;
  isLoading?: boolean;
}

const typeConfig: Record<string, { label: string; color: string; icon: string }> = {
  target: { label: 'Target Wallet', color: '#e34946', icon: '◎' },
  funder: { label: 'Funder', color: '#64b5f6', icon: '↑' },
  funded: { label: 'Funded Wallet', color: '#ce93d8', icon: '↓' },
  holder: { label: 'Token Holder', color: '#5a7a9a', icon: '●' },
  token: { label: 'Token', color: '#ffd54f', icon: '★' },
  'cabal-funder': { label: 'CABAL FUNDER', color: '#ff3366', icon: '⚠' },
  connected: { label: 'Connected to Cabal', color: '#ff9f43', icon: '◆' },
};

function formatAmount(amount: number): string {
  if (amount >= 1e9) return (amount / 1e9).toFixed(2) + 'B';
  if (amount >= 1e6) return (amount / 1e6).toFixed(2) + 'M';
  if (amount >= 1e3) return (amount / 1e3).toFixed(2) + 'K';
  return amount.toFixed(2);
}

export function NodeDetailPanel({
  node,
  walletProfile,
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

  const config = typeConfig[node.type] || { label: node.type, color: '#4a5a6a', icon: '●' };
  const isSuspicious = node.type === 'cabal-funder' || node.metadata?.suspicious;

  return (
    <div
      className={`
        w-80 rounded-lg overflow-hidden font-mono
        bg-[#0a0a0a] border
        ${isSuspicious ? 'border-[#ff3366]/50' : 'border-[#1f2937]'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#111114] border-b border-[#1f2937]">
        <div className="flex items-center gap-2" style={{ color: config.color }}>
          <span className="text-lg">{config.icon}</span>
          <span className="text-xs font-bold uppercase tracking-wider">{config.label}</span>
        </div>
        <button
          onClick={onClose}
          className="text-[#6b7280] hover:text-white transition-colors p-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Address */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0d0d10] border-b border-[#1f2937]">
        <code className="text-xs text-[#e34946]">{truncateAddress(node.id, 8)}</code>
        <button
          onClick={handleCopy}
          className={`
            p-1.5 rounded border transition-all text-xs
            ${copied
              ? 'bg-[#22c55e]/10 border-[#22c55e]/50 text-[#22c55e]'
              : 'bg-[#1a1a24] border-[#2a2a3a] text-[#6b7280] hover:border-[#4a9eff] hover:text-[#4a9eff]'
            }
          `}
          title="Copy address"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 border-b border-[#1f2937]">
        {node.solBalance !== undefined && (
          <div className="px-4 py-3 border-r border-[#1f2937]">
            <div className="text-[9px] text-[#4b5563] uppercase tracking-wider mb-1">Balance</div>
            <div className="text-sm text-white font-medium">{node.solBalance.toFixed(4)} SOL</div>
          </div>
        )}
        {node.tokenAmount !== undefined && (
          <div className="px-4 py-3">
            <div className="text-[9px] text-[#4b5563] uppercase tracking-wider mb-1">Holding</div>
            <div className="text-sm text-white font-medium">{formatAmount(node.tokenAmount)}</div>
          </div>
        )}
        {node.metadata?.fundedCount && node.metadata.fundedCount > 1 && (
          <div className="px-4 py-3 col-span-2 bg-[#ff3366]/10">
            <div className="text-[9px] text-[#ff3366] uppercase tracking-wider mb-1">Funded Holders</div>
            <div className="text-sm text-[#ff3366] font-bold">{node.metadata.fundedCount}</div>
          </div>
        )}
      </div>

      {/* Wallet Profile / Forensics */}
      {walletProfile && (
        <div className="px-4 py-3 border-b border-[#1f2937]">
          <h4 className="text-[10px] text-[#6b7280] uppercase tracking-wider mb-3">Wallet Forensics</h4>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[9px] text-[#4b5563] uppercase">Age</div>
              <div className={`text-xs ${walletProfile.isFreshWallet ? 'text-[#f59e0b]' : 'text-white'}`}>
                {walletProfile.walletAgeDays} days
                {walletProfile.isFreshWallet && (
                  <span className="ml-1 px-1 py-0.5 text-[8px] bg-[#f59e0b]/20 text-[#f59e0b] rounded">FRESH</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[#4b5563] uppercase">Transactions</div>
              <div className="text-xs text-white">{walletProfile.totalTxCount}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#4b5563] uppercase">SOL In</div>
              <div className="text-xs text-white">{walletProfile.totalSolReceived.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[9px] text-[#4b5563] uppercase">SOL Out</div>
              <div className="text-xs text-white">{walletProfile.totalSolSent.toFixed(2)}</div>
            </div>
          </div>

          {walletProfile.suspiciousPatterns.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#1f2937]">
              {walletProfile.suspiciousPatterns.map((pattern, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-[#f59e0b] mb-1">
                  <span>⚠</span>
                  <span>{pattern}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && !walletProfile && (
        <div className="flex items-center justify-center gap-2 px-4 py-4 text-[#6b7280] text-xs">
          <div className="w-3 h-3 border border-[#4a9eff] border-t-transparent rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {node.type !== 'token' && (
          <>
            {!node.expanded && onExpandFunding && (
              <button
                onClick={onExpandFunding}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#e34946] text-black text-[10px] font-bold rounded hover:bg-[#ff4d4d] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
                Trace Funders
              </button>
            )}
            {onExpandFunded && (
              <button
                onClick={onExpandFunded}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a24] border border-[#2a2a3a] text-[#9898a6] text-[10px] font-bold rounded hover:border-[#4a9eff] hover:text-[#4a9eff] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
                Show Funded
              </button>
            )}
          </>
        )}

        <a
          href={`https://solscan.io/account/${node.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a24] border border-[#2a2a3a] text-[#6b7280] text-[10px] font-bold rounded hover:border-[#4a9eff] hover:text-[#4a9eff] transition-colors"
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
