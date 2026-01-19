'use client';

import { useState, useCallback, useRef } from 'react';
import {
  GraphData,
  AppMode,
  TraceResponse,
  TokenResponse,
  ExpandResponse,
  ScanResponse,
  HeliusTransaction,
  GraphUpdate,
  TokenSecurityInfo,
  TokenMetadata,
} from '@/lib/types';
import { mergeGraphUpdate } from '@/lib/transaction-processor';
import { useTransactionStream } from './useTransactionStream';

interface Stats {
  nodesFound?: number;
  linksFound?: number;
  scanDepth?: number;
  totalHolders?: number;
  analyzedHolders?: number;
  cabalConnectionsFound?: number;
  suspiciousWallets?: string[];
  dexFundedHolders?: number;
  freshWalletFunders?: number;
}

interface StreamTransaction {
  id: string;
  signature: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  type: 'incoming' | 'outgoing' | 'internal';
}

interface StreamingStats {
  isStreaming: boolean;
  isConnecting: boolean;
  watchedAddresses: string[];
  transactionCount: number;
  transactions: StreamTransaction[];
  error: string | null;
}

interface UseGraphDataReturn {
  data: GraphData | null;
  stats: Stats | null;
  tokenSecurity: TokenSecurityInfo | null;
  tokenMetadata: TokenMetadata | null;
  detectedMode: AppMode | null;
  isLoading: boolean;
  isDetecting: boolean;
  error: string | null;
  scan: (address: string, mode: AppMode) => Promise<void>;
  scanWithAutoDetect: (address: string) => Promise<AppMode | null>;
  expandNode: (nodeId: string, mode: 'funding' | 'funded') => Promise<void>;
  reset: () => void;
  streaming: StreamingStats;
  startStreaming: () => void;
  stopStreaming: () => void;
}

export function useGraphData(): UseGraphDataReturn {
  const [data, setData] = useState<GraphData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tokenSecurity, setTokenSecurity] = useState<TokenSecurityInfo | null>(null);
  const [tokenMetadata, setTokenMetadata] = useState<TokenMetadata | null>(null);
  const [detectedMode, setDetectedMode] = useState<AppMode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watchedAddresses, setWatchedAddresses] = useState<string[]>([]);
  const [streamTransactions, setStreamTransactions] = useState<StreamTransaction[]>([]);

  // Use ref to avoid stale closure in handleNewTransaction
  const dataRef = useRef<GraphData | null>(null);
  dataRef.current = data;
  const watchedRef = useRef<string[]>([]);
  watchedRef.current = watchedAddresses;

  // Handle new transactions from the stream - uses ref to avoid dependency on data
  const handleNewTransaction = useCallback(
    (tx: HeliusTransaction, update: GraphUpdate) => {
      const currentData = dataRef.current;
      if (!currentData) return;

      // Merge new nodes and links into existing data
      const merged = mergeGraphUpdate(currentData.nodes, currentData.links, update);

      setData({
        nodes: merged.nodes,
        links: merged.links,
      });

      setStats((prev) => ({
        ...prev,
        nodesFound: merged.nodes.length,
        linksFound: merged.links.length,
      }));

      // Extract transaction info for the feed
      const watched = new Set(watchedRef.current);
      if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
        for (const transfer of tx.nativeTransfers) {
          const from = transfer.fromUserAccount;
          const to = transfer.toUserAccount;
          const amount = transfer.amount / 1e9;

          if (amount > 0.0001) {
            const txType: 'incoming' | 'outgoing' | 'internal' =
              watched.has(from) && watched.has(to) ? 'internal' :
              watched.has(to) ? 'incoming' : 'outgoing';

            // Use unique ID with index to handle multiple transfers in same tx
            const uniqueId = `${tx.signature}_${from.slice(0,8)}_${to.slice(0,8)}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

            setStreamTransactions(prev => {
              // Check if this exact transfer already exists
              const exists = prev.some(p =>
                p.signature === tx.signature &&
                p.from === from &&
                p.to === to
              );
              if (exists) return prev;

              return [{
                id: uniqueId,
                signature: tx.signature,
                from,
                to,
                amount,
                timestamp: tx.timestamp || Math.floor(Date.now() / 1000),
                type: txType,
              }, ...prev].slice(0, 50);
            });
          }
        }
      }

      console.log('[useGraphData] Merged update:', {
        newNodes: update.newNodes.length,
        newLinks: update.newLinks.length,
        totalNodes: merged.nodes.length,
        totalLinks: merged.links.length,
      });
    },
    [] // No dependencies - uses ref instead
  );

  // Initialize transaction stream
  const {
    isConnected,
    isConnecting,
    error: streamError,
    transactionCount,
    connect,
    disconnect,
  } = useTransactionStream(data?.nodes || [], {
    onNewTransaction: handleNewTransaction,
    onConnect: (addresses) => {
      console.log('[useGraphData] Stream connected to:', addresses);
    },
    onError: (err, address) => {
      console.error('[useGraphData] Stream error:', err, address);
    },
  });

  const scan = useCallback(async (address: string, mode: AppMode) => {
    setIsLoading(true);
    setError(null);

    try {
      const endpoint = mode === 'wallet' ? '/api/trace' : '/api/token';
      const body = mode === 'wallet'
        ? { wallet: address, depth: 2 }
        : { mint: address, topHolders: 50 };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result: TraceResponse | TokenResponse = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Scan failed');
      }

      setData(result.data);
      setStats(result.stats || null);
      setTokenSecurity((result as TokenResponse).tokenSecurity || null);
      setTokenMetadata((result as TokenResponse).tokenMetadata || null);
      setDetectedMode(mode);

      const addressesToWatch = result.data.nodes
        .slice(0, 10)
        .map((n) => n.id);
      setWatchedAddresses(addressesToWatch);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      setError(message);
      console.error('Scan error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const scanWithAutoDetect = useCallback(async (address: string): Promise<AppMode | null> => {
    setIsDetecting(true);
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      const result: ScanResponse = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Scan failed');
      }

      setData(result.data);
      setStats(result.stats || null);
      setTokenSecurity(result.tokenSecurity || null);
      setTokenMetadata(result.tokenMetadata || null);
      setDetectedMode(result.mode || null);

      const addressesToWatch = result.data.nodes
        .slice(0, 10)
        .map((n) => n.id);
      setWatchedAddresses(addressesToWatch);

      return result.mode || null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      setError(message);
      console.error('Scan error:', err);
      return null;
    } finally {
      setIsDetecting(false);
      setIsLoading(false);
    }
  }, []);

  const expandNode = useCallback(async (nodeId: string, mode: 'funding' | 'funded') => {
    const currentData = dataRef.current;
    if (!currentData) return;

    setIsLoading(true);
    setError(null);

    try {
      const existingNodeIds = currentData.nodes.map(n => n.id);

      const response = await fetch('/api/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: nodeId,
          mode,
          existingNodes: existingNodeIds,
        }),
      });

      const result: ExpandResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Expansion failed');
      }

      if (result.newNodes && result.newLinks) {
        setData(prev => {
          if (!prev) return prev;

          const existingIds = new Set(prev.nodes.map(n => n.id));
          const newNodes = result.newNodes!.filter(n => !existingIds.has(n.id));

          const existingLinkIds = new Set(
            prev.links.map(l => `${l.source}->${l.target}`)
          );
          const newLinks = result.newLinks!.filter(
            l => !existingLinkIds.has(`${l.source}->${l.target}`)
          );

          const updatedNodes = prev.nodes.map(n =>
            n.id === nodeId ? { ...n, expanded: true } : n
          );

          const allNodeIds = [...updatedNodes, ...newNodes].map(n => n.id);
          setWatchedAddresses(allNodeIds.slice(0, 10));

          return {
            nodes: [...updatedNodes, ...newNodes],
            links: [...prev.links, ...newLinks],
          };
        });

        setStats(prev => ({
          ...prev,
          nodesFound: (prev?.nodesFound || 0) + (result.newNodes?.length || 0),
          linksFound: (prev?.linksFound || 0) + (result.newLinks?.length || 0),
        }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Expansion failed';
      setError(message);
      console.error('Expand error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    disconnect();
    setData(null);
    setStats(null);
    setTokenSecurity(null);
    setTokenMetadata(null);
    setDetectedMode(null);
    setError(null);
    setWatchedAddresses([]);
    setStreamTransactions([]);
  }, [disconnect]);

  const startStreaming = useCallback(() => {
    if (watchedAddresses.length > 0) {
      connect(watchedAddresses);
    }
  }, [connect, watchedAddresses]);

  const stopStreaming = useCallback(() => {
    disconnect();
  }, [disconnect]);

  return {
    data,
    stats,
    tokenSecurity,
    tokenMetadata,
    detectedMode,
    isLoading,
    isDetecting,
    error,
    scan,
    scanWithAutoDetect,
    expandNode,
    reset,
    streaming: {
      isStreaming: isConnected,
      isConnecting,
      watchedAddresses,
      transactionCount,
      transactions: streamTransactions,
      error: streamError,
    },
    startStreaming,
    stopStreaming,
  };
}

export default useGraphData;
