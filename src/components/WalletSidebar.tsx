'use client';

import { useState, useEffect, useCallback } from 'react';
import { GraphNode } from '@/lib/types';
import { THREAT_COLORS } from '@/lib/threat-scorer';
import { truncateAddress } from '@/lib/address-utils';
import { formatUsd, formatCompact, timeAgo } from '@/lib/format';

interface WalletProfileData {
  success: boolean;
  balances?: {
    balances: { mint: string; symbol: string; name: string; balance: number; usdValue: number; logoUri?: string }[];
    totalUsdValue: number;
  } | null;
  fundedBy?: {
    address: string;
    amount: number;
    timestamp: number;
    txSignature: string;
    txType: string;
    txSource: string;
  } | null;
  recentActivity?: {
    signature: string;
    timestamp: number;
    type: string;
    direction: 'in' | 'out';
    counterparty: string;
    mint: string;
    amount: number;
    symbol: string | null;
  }[];
  error?: string;
}

interface WalletSidebarProps {
  address: string | null;
  onClose: () => void;
  graphNodes: GraphNode[];
}

export function WalletSidebar({ address, onClose, graphNodes }: WalletSidebarProps) {
  const [profile, setProfile] = useState<WalletProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProfile = useCallback(async (addr: string) => {
    setIsLoading(true);
    setProfile(null);
    try {
      const res = await fetch(`/api/wallet-profile?address=${addr}`);
      const data: WalletProfileData = await res.json();
      setProfile(data);
    } catch {
      setProfile({ success: false, error: 'Failed to fetch profile' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (address) fetchProfile(address);
  }, [address, fetchProfile]);

  const node = address ? graphNodes.find(n => n.id === address) : null;
  const threatLevel = node?.metadata?.threatLevel;
  const threatScore = node?.metadata?.threatScore ?? 0;
  const isOpen = !!address;

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={`fixed right-0 z-50 h-full overflow-y-auto themed-scrollbar transition-transform duration-300 ease-out
          w-full md:w-80 xl:w-96
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
        style={{
          top: 0,
          background: 'var(--bg-base)',
          borderLeft: '1px solid var(--border-base)',
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4"
          style={{
            height: 'var(--header-height)',
            background: 'var(--bg-base)',
            borderBottom: '1px solid var(--border-base)',
          }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Wallet Profile</span>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!address ? null : (
          <div className="px-4 py-3 space-y-4">
            {/* Address + threat badge */}
            <div>
              <p className="font-mono text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>{truncateAddress(address, 6)}</p>
              <a
                href={`https://orbmarkets.io/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] underline"
                style={{ color: 'var(--text-tertiary)' }}
              >
                View on Orb
              </a>

              {threatLevel && threatLevel !== 'safe' && (
                <div
                  className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium"
                  style={{
                    background: THREAT_COLORS[threatLevel] + '18',
                    color: THREAT_COLORS[threatLevel],
                    border: `1px solid ${THREAT_COLORS[threatLevel]}33`,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.96l-6.93-12a2 2 0 00-3.5 0l-6.93 12A2 2 0 005.07 19z" />
                  </svg>
                  {threatLevel.charAt(0).toUpperCase() + threatLevel.slice(1)} ({threatScore})
                </div>
              )}
            </div>

            {/* Identity section */}
            {node?.identity?.name && (
              <Section title="Identity">
                <Row label="Name" value={node.identity.name} />
                {node.identity.category && <Row label="Category" value={node.identity.category} />}
                {node.identity.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {node.identity.tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* Loading skeleton */}
            {isLoading && (
              <div className="space-y-3">
                <SkeletonBlock lines={3} />
                <SkeletonBlock lines={2} />
                <SkeletonBlock lines={4} />
              </div>
            )}

            {/* Balances */}
            {profile?.balances && (
              <Section title="Top Holdings">
                <div className="mb-2">
                  <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatUsd(profile.balances.totalUsdValue)}
                  </span>
                  <span className="text-[10px] ml-1" style={{ color: 'var(--text-tertiary)' }}>total</span>
                </div>
                <div className="space-y-1.5">
                  {profile.balances.balances
                    .filter(b => b.usdValue > 0.01)
                    .sort((a, b) => b.usdValue - a.usdValue)
                    .slice(0, 8)
                    .map(b => (
                      <div key={b.mint} className="flex justify-between items-center text-[11px]">
                        <span style={{ color: 'var(--text-secondary)' }}>{b.symbol || truncateAddress(b.mint, 3)}</span>
                        <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>
                          {formatCompact(b.balance)} <span style={{ color: 'var(--text-tertiary)' }}>({formatUsd(b.usdValue)})</span>
                        </span>
                      </div>
                    ))
                  }
                </div>
              </Section>
            )}

            {/* Funded by */}
            {profile?.fundedBy && (
              <Section title="Funded By">
                <div className="text-[11px] space-y-1">
                  <Row label="Funder" value={truncateAddress(profile.fundedBy.address, 5)} mono />
                  <Row label="Amount" value={`${profile.fundedBy.amount.toFixed(4)} SOL`} />
                  <Row label="Source" value={profile.fundedBy.txSource} />
                  {profile.fundedBy.timestamp > 0 && (
                    <Row label="When" value={timeAgo(profile.fundedBy.timestamp)} />
                  )}
                </div>
              </Section>
            )}

            {/* Recent Activity */}
            {profile?.recentActivity && profile.recentActivity.length > 0 && (
              <Section title="Recent Activity">
                <div className="space-y-2">
                  {profile.recentActivity.filter((tx, i, arr) => arr.findIndex(t => t.signature === tx.signature) === i).map(tx => (
                    <div key={tx.signature} className="text-[11px]" style={{ borderBottom: '1px solid var(--bg-elevated)', paddingBottom: 6 }}>
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {tx.direction === 'in' ? 'Received' : 'Sent'} {formatCompact(tx.amount)} {tx.symbol || truncateAddress(tx.mint, 3)}
                        </span>
                        <span style={{ color: 'var(--text-tertiary)' }}>{timeAgo(tx.timestamp)}</span>
                      </div>
                      <p className="text-[10px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>
                        {tx.direction === 'in' ? 'from' : 'to'} {truncateAddress(tx.counterparty, 5)}
                      </p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Error state */}
            {profile && !profile.success && (
              <div className="text-xs py-2" style={{ color: 'var(--red-primary)' }}>
                {profile.error || 'Failed to load profile data'}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border-base)' }} className="pt-3">
      <h3 className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className={mono ? 'font-mono' : ''} style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

function SkeletonBlock({ lines }: { lines: number }) {
  const widths = ['82%', '68%', '74%', '56%'];

  return (
    <div className="space-y-2 pt-3" style={{ borderTop: '1px solid var(--border-base)' }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded animate-pulse"
          style={{ background: 'var(--bg-elevated)', width: widths[i % widths.length] }}
        />
      ))}
    </div>
  );
}

