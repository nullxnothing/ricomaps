'use client';

import { useState, useEffect, useRef } from 'react';
import { truncateAddress } from '@/lib/address-utils';

interface Transaction {
  id: string;
  signature: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  type: 'incoming' | 'outgoing' | 'internal';
  isNew?: boolean;
}

interface TransactionFeedProps {
  transactions: Transaction[];
  maxItems?: number;
  onAddressClick?: (address: string) => void;
}

export function TransactionFeed({
  transactions,
  maxItems = 10,
  onAddressClick
}: TransactionFeedProps) {
  const [displayedTxs, setDisplayedTxs] = useState<Transaction[]>([]);
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());
  const prevCountRef = useRef(0);

  useEffect(() => {
    const newTxs = transactions.slice(0, maxItems);

    // Detect new transactions
    if (transactions.length > prevCountRef.current) {
      const newIds = new Set(
        transactions
          .slice(0, transactions.length - prevCountRef.current)
          .map(tx => tx.id)
      );
      setAnimatingIds(newIds);

      // Clear animation after delay
      setTimeout(() => {
        setAnimatingIds(new Set());
      }, 2000);
    }

    prevCountRef.current = transactions.length;
    setDisplayedTxs(newTxs);
  }, [transactions, maxItems]);

  if (displayedTxs.length === 0) {
    return (
      <div className="tx-feed-empty">
        <div className="tx-feed-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p>Waiting for transactions...</p>
      </div>
    );
  }

  return (
    <div className="tx-feed">
      <div className="tx-feed-header">
        <div className="tx-feed-title">
          <span className="tx-feed-pulse" />
          Live Transactions
        </div>
        <span className="tx-feed-count">{transactions.length} total</span>
      </div>

      <div className="tx-feed-list">
        {displayedTxs.map((tx) => {
          const isAnimating = animatingIds.has(tx.id);
          const timeAgo = formatTimeAgo(tx.timestamp);

          return (
            <div
              key={tx.id}
              className={`tx-feed-item ${isAnimating ? 'tx-feed-item-new' : ''} tx-feed-item-${tx.type}`}
            >
              <div className="tx-feed-item-indicator">
                {tx.type === 'incoming' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4l-8 8h5v8h6v-8h5z" transform="rotate(180 12 12)" />
                  </svg>
                )}
                {tx.type === 'outgoing' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4l-8 8h5v8h6v-8h5z" />
                  </svg>
                )}
                {tx.type === 'internal' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                )}
              </div>

              <div className="tx-feed-item-content">
                <div className="tx-feed-item-addresses">
                  <button
                    className="tx-feed-address"
                    onClick={() => onAddressClick?.(tx.from)}
                  >
                    {truncateAddress(tx.from, 4)}
                  </button>
                  <span className="tx-feed-arrow">→</span>
                  <button
                    className="tx-feed-address"
                    onClick={() => onAddressClick?.(tx.to)}
                  >
                    {truncateAddress(tx.to, 4)}
                  </button>
                </div>
                <div className="tx-feed-item-meta">
                  <span className="tx-feed-amount">
                    {tx.amount.toFixed(4)} SOL
                  </span>
                  <span className="tx-feed-time">{timeAgo}</span>
                </div>
              </div>

              <a
                href={`https://solscan.io/tx/${tx.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tx-feed-link"
                title="View on Solscan"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                </svg>
              </a>

              {isAnimating && <div className="tx-feed-item-glow" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default TransactionFeed;
