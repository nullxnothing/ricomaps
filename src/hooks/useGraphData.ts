'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GraphData,
  GraphNode,
  AppMode,
  ExpandResponse,
  ScanResponse,
  TokenSecurityInfo,
  TokenMetadata,
} from '@/lib/types';
import { useHolderPolling } from './useHolderPolling';

interface Stats {
  nodesFound?: number;
  linksFound?: number;
  scanDepth?: number;
  totalHolders?: number;
  analyzedHolders?: number;
  analysisIncomplete?: boolean;
  cabalConnectionsFound?: number;
  suspiciousWallets?: string[];
  dexFundedHolders?: number;
  freshWalletFunders?: number;
  snipersDetected?: number;
  sniperWallets?: string[];
  bundleClustersDetected?: number;
  bundledWallets?: string[];
}

interface StreamingStats {
  isStreaming: boolean;
  isConnecting: boolean;
  watchedAddresses: string[];
  transactionCount: number;
  transactions: never[];
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

function endpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
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
  const [scannedMint, setScannedMint] = useState<string | null>(null);

  const dataRef = useRef<GraphData | null>(null);
  dataRef.current = data;

  // Handle holder balance diffs from polling
  // Poll diff handler — ONLY updates balances of existing graph nodes.
  // Does NOT add new holders (scan already filtered LP/programs/etc).
  // Removes holders that sold to 0.
  const handleHolderDiff = useCallback(
    (diff: { added: { owner: string; amount: number }[]; removed: string[]; changed: { owner: string; amount: number }[] }) => {
      const currentData = dataRef.current;
      if (!currentData) return;

      let nodes = [...currentData.nodes];
      let hasChanges = false;

      // Update changed holder balances (only nodes already in graph)
      for (const h of diff.changed) {
        const idx = nodes.findIndex(n => n.id === h.owner);
        if (idx !== -1) {
          nodes[idx] = { ...nodes[idx], tokenAmount: h.amount };
          hasChanges = true;
        }
      }

      // Remove holders that sold everything (balance went to 0)
      if (diff.removed.length > 0) {
        const graphIds = new Set(nodes.map(n => n.id));
        const toRemove = diff.removed.filter(id => graphIds.has(id));
        if (toRemove.length > 0) {
          const removedSet = new Set(toRemove);
          nodes = nodes.filter(n => !removedSet.has(n.id));
          hasChanges = true;
        }
      }

      // Skip diff.added — do NOT add new holders from poll.
      // The scan already applied filters (LP, programs, etc).
      // Adding raw poll holders would reintroduce filtered addresses.

      if (hasChanges) {
        setData({ nodes, links: currentData.links });
        setStats(prev => ({
          ...prev,
          nodesFound: nodes.length,
        }));
      }
    },
    []
  );

  // Holder polling — polls /api/poll every 10s, diffs against current graph
  const {
    isPolling,
    pollCount,
    error: pollError,
    start: startPoll,
    stop: stopPoll,
  } = useHolderPolling(scannedMint, data, handleHolderDiff);

  useEffect(() => {
    return () => { stopPoll(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = useCallback(async (address: string, mode: AppMode) => {
    stopPoll();
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

      const result = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Scan failed');
      }

      setData(result.data);
      setStats(result.stats || null);
      setTokenSecurity(result.tokenSecurity || null);
      setTokenMetadata(result.tokenMetadata || null);
      setDetectedMode(mode);

      // Store mint for polling (only for token mode)
      if (mode === 'token') {
        setScannedMint(address);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      setError(message);
      console.error('Scan error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [stopPoll]);

  const scanWithAutoDetect = useCallback(async (address: string): Promise<AppMode | null> => {
    stopPoll();
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

      // Store mint for polling (only for token mode)
      if (result.mode === 'token') {
        setScannedMint(address);
      }

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
  }, [stopPoll]);

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
            prev.links.map(l => `${endpointId(l.source)}->${endpointId(l.target)}`)
          );
          const newLinks = result.newLinks!.filter(
            l => !existingLinkIds.has(`${endpointId(l.source)}->${endpointId(l.target)}`)
          );

          const updatedNodes = prev.nodes.map(n =>
            n.id === nodeId ? { ...n, expanded: true } : n
          );

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
    stopPoll();
    setData(null);
    setStats(null);
    setTokenSecurity(null);
    setTokenMetadata(null);
    setDetectedMode(null);
    setError(null);
    setScannedMint(null);
  }, [stopPoll]);

  const startStreaming = useCallback(() => {
    startPoll();
  }, [startPoll]);

  const stopStreaming = useCallback(() => {
    stopPoll();
  }, [stopPoll]);

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
      isStreaming: isPolling,
      isConnecting: false,
      watchedAddresses: scannedMint ? [scannedMint] : [],
      transactionCount: pollCount,
      transactions: [],
      error: pollError,
    },
    startStreaming,
    stopStreaming,
  };
}

export default useGraphData;
