'use client';

import { useBlacklist } from '@/hooks/useBlacklist';
import { ClusterCard } from './ClusterCard';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

export function BlacklistView() {
  const router = useRouter();
  const {
    clusters,
    totalClusters,
    totalWallets,
    page,
    totalPages,
    sortBy,
    isLoading,
    error,
    walletSearch,
    setPage,
    setSortBy,
    setWalletSearch,
    refresh,
    exportCsv,
  } = useBlacklist();

  const handleWalletClick = useCallback((address: string) => {
    router.push(`/?address=${address}`);
  }, [router]);

  const handleTokenScan = useCallback((mint: string) => {
    router.push(`/?address=${mint}`);
  }, [router]);

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-3" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border-base)' }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="btn-back" title="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--purple-primary)' }}>Blacklist</h1>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {totalClusters} clusters &middot; {totalWallets} wallets
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={refresh} className="btn-ghost text-xs" disabled={isLoading}>
              Refresh
            </button>
            <button onClick={exportCsv} className="btn-ghost text-xs" disabled={totalClusters === 0}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline mr-1">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              CSV
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Controls */}
        <div className="flex items-center gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by wallet address..."
            value={walletSearch}
            onChange={(e) => setWalletSearch(e.target.value)}
            className="flex-1 text-sm px-3 py-2 rounded-lg"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="text-xs px-3 py-2 rounded-lg"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-base)',
              color: 'var(--text-secondary)',
              outline: 'none',
            }}
          >
            <option value="confidence">Confidence</option>
            <option value="last_seen">Last Seen</option>
            <option value="total_appearances">Token Count</option>
            <option value="wallet_count">Cluster Size</option>
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="glass-panel-danger p-3 mb-4">
            <p className="text-sm" style={{ color: 'var(--red-primary)' }}>{error}</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && clusters.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <div className="spinner-lg" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && clusters.length === 0 && !error && (
          <div className="text-center py-16">
            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>No bundle clusters detected yet</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Scan tokens to detect coordinated bundlers. Clusters accumulate across scans.
            </p>
          </div>
        )}

        {/* Cluster list */}
        <div className="space-y-2">
          {clusters.map(cluster => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              onWalletClick={handleWalletClick}
              onTokenScan={handleTokenScan}
            />
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              className="btn-ghost text-xs"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
            >
              Prev
            </button>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {page} / {totalPages}
            </span>
            <button
              className="btn-ghost text-xs"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
