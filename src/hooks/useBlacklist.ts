'use client';

import { useState, useCallback, useEffect } from 'react';
import { BundleCluster } from '@/lib/types';

type SortField = 'confidence' | 'last_seen' | 'total_appearances' | 'wallet_count';

interface UseBlacklistReturn {
  clusters: BundleCluster[];
  totalClusters: number;
  totalWallets: number;
  page: number;
  totalPages: number;
  sortBy: SortField;
  isLoading: boolean;
  error: string | null;
  walletSearch: string;
  setPage: (page: number) => void;
  setSortBy: (sort: SortField) => void;
  setWalletSearch: (search: string) => void;
  refresh: () => void;
  exportCsv: () => void;
}

export function useBlacklist(): UseBlacklistReturn {
  const [clusters, setClusters] = useState<BundleCluster[]>([]);
  const [totalClusters, setTotalClusters] = useState(0);
  const [totalWallets, setTotalWallets] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [sortBy, setSortBy] = useState<SortField>('confidence');
  const [walletSearch, setWalletSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClusters = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sort: sortBy,
      });
      if (walletSearch) params.set('wallet', walletSearch);

      const response = await fetch(`/api/blacklist?${params}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch blacklist');
      }

      setClusters(result.clusters);
      setTotalClusters(result.totalClusters);
      setTotalWallets(result.totalWallets);
      setTotalPages(result.totalPages);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch blacklist';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [page, sortBy, walletSearch]);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  const exportCsv = useCallback(() => {
    const link = document.createElement('a');
    link.href = '/api/blacklist/export';
    link.download = `blacklist-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  return {
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
    setSortBy: (sort: SortField) => { setSortBy(sort); setPage(1); },
    setWalletSearch: (search: string) => { setWalletSearch(search); setPage(1); },
    refresh: fetchClusters,
    exportCsv,
  };
}
