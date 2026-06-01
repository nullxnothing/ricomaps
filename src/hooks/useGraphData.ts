'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GraphData,
  GraphNode,
  GraphLink,
  AppMode,
  ExpandResponse,
  ScanResponse,
  TokenSecurityInfo,
  TokenMetadata,
  HolderDelta,
  NODE_COLORS,
} from '@/lib/types';
import { useHolderPolling } from './useHolderPolling';
import { useHolderStream } from './useHolderStream';
import { shouldFilterAddress } from '@/lib/address-utils';
import { createNode } from '@/lib/graph-utils';

// Wait this long for the live stream to connect before falling back to polling.
const STREAM_CONNECT_GRACE_MS = 6_000;
// Flush a same-slot buyer buffer this long after the last buyer in that slot.
const SLOT_FLUSH_MS = 1_500;

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
  transport: 'laserstream' | 'polling';
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

  const [liveEnabled, setLiveEnabled] = useState(false);
  const [wsFallback, setWsFallback] = useState(false);

  const dataRef = useRef<GraphData | null>(null);
  dataRef.current = data;

  // SSE callbacks fire outside React's render closure — read the live mint via a ref.
  const scannedMintRef = useRef<string | null>(null);
  scannedMintRef.current = scannedMint;

  // Same-slot co-buy buffer for live bundle detection.
  const slotBufferRef = useRef<{ slot: number; owners: string[] } | null>(null);
  const slotFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flag the buffered same-slot new buyers as a bundle if 2+ landed together.
  const flushSlotBuffer = useCallback(() => {
    const buffer = slotBufferRef.current;
    slotBufferRef.current = null;
    if (!buffer || buffer.owners.length < 2) return;

    const bundledSet = new Set(buffer.owners);
    setData(prev => {
      if (!prev) return prev;
      let touched = false;
      const nodes = prev.nodes.map(n => {
        if (!bundledSet.has(n.id) || n.type === 'bundled') return n;
        touched = true;
        return {
          ...n,
          type: 'bundled' as const,
          color: NODE_COLORS.bundled,
          metadata: { ...n.metadata, suspicious: true, isBundled: true },
        };
      });
      return touched ? { nodes, links: prev.links } : prev;
    });
  }, []);

  // Single source of truth for applying one holder balance change to the graph.
  // - existing node, balance > 0  → update tokenAmount
  // - existing node, balance == 0 → remove node + its links
  // - new owner, balance > 0, not filtered → add holder node + link to token, buffer for bundle check
  // - new owner, balance == 0 / filtered → ignore
  const applyHolderDelta = useCallback((delta: HolderDelta) => {
    const mint = scannedMintRef.current;
    const currentData = dataRef.current;
    if (!currentData || !mint) return;
    if (shouldFilterAddress(delta.owner) || delta.owner === mint) return;

    const existingIdx = currentData.nodes.findIndex(n => n.id === delta.owner);

    // Existing node.
    if (existingIdx !== -1) {
      if (delta.newBalance <= 0) {
        const nodes = currentData.nodes.filter(n => n.id !== delta.owner);
        const links = currentData.links.filter(
          l => endpointId(l.source) !== delta.owner && endpointId(l.target) !== delta.owner,
        );
        setData({ nodes, links });
        setStats(prev => ({ ...prev, nodesFound: nodes.length, linksFound: links.length }));
      } else {
        const nodes = [...currentData.nodes];
        nodes[existingIdx] = { ...nodes[existingIdx], tokenAmount: delta.newBalance };
        setData({ nodes, links: currentData.links });
      }
      return;
    }

    // New owner buying in.
    if (delta.newBalance <= 0) return;
    const newNode = createNode(delta.owner, 1, 'holder', delta.newBalance);
    const newLink: GraphLink = {
      source: mint,
      target: delta.owner,
      value: 0,
      txSignature: delta.signature,
      timestamp: Date.now(),
    };
    const nodes = [...currentData.nodes, newNode];
    const links = [...currentData.links, newLink];
    setData({ nodes, links });
    setStats(prev => ({ ...prev, nodesFound: nodes.length, linksFound: links.length }));

    // Buffer this new buyer for same-slot bundle detection.
    const buffer = slotBufferRef.current;
    if (buffer && buffer.slot === delta.slot) {
      buffer.owners.push(delta.owner);
    } else {
      if (buffer) flushSlotBuffer();
      slotBufferRef.current = { slot: delta.slot, owners: [delta.owner] };
    }
    if (slotFlushTimerRef.current) clearTimeout(slotFlushTimerRef.current);
    slotFlushTimerRef.current = setTimeout(flushSlotBuffer, SLOT_FLUSH_MS);
  }, [flushSlotBuffer]);

  // Live stream handler — one delta at a time from the LaserStream worker.
  const handleHolderDelta = useCallback((delta: HolderDelta) => {
    applyHolderDelta(delta);
  }, [applyHolderDelta]);

  // Poll fallback handler — adapt {added, removed, changed} into per-owner deltas
  // and run them through the SAME apply logic so behaviour matches the live path.
  const handleHolderDiff = useCallback(
    (diff: { added: { owner: string; amount: number }[]; removed: string[]; changed: { owner: string; amount: number }[] }) => {
      for (const h of diff.changed) {
        applyHolderDelta({ owner: h.owner, newBalance: h.amount, delta: 0, slot: 0, signature: '' });
      }
      for (const h of diff.added) {
        applyHolderDelta({ owner: h.owner, newBalance: h.amount, delta: h.amount, slot: 0, signature: '' });
      }
      for (const owner of diff.removed) {
        applyHolderDelta({ owner, newBalance: 0, delta: 0, slot: 0, signature: '' });
      }
    },
    [applyHolderDelta]
  );

  // Live: LaserStream worker via SSE (push-based). Falls back to polling when unavailable.
  const {
    connected: streamConnected,
    error: streamError,
    eventCount: streamEventCount,
    unsupported: streamUnsupported,
  } = useHolderStream(scannedMint, liveEnabled && detectedMode === 'token', handleHolderDelta);

  // If the stream isn't configured, or never connects within a grace window, fall back to polling.
  useEffect(() => {
    if (!liveEnabled || detectedMode !== 'token') {
      setWsFallback(false);
      return;
    }
    if (streamUnsupported) {
      setWsFallback(true);
      return;
    }
    if (streamConnected) {
      setWsFallback(false);
      return;
    }
    const timer = setTimeout(() => {
      if (!streamConnected) setWsFallback(true);
    }, STREAM_CONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [liveEnabled, detectedMode, streamUnsupported, streamConnected]);

  // Poll fallback transport — only runs when the stream is unavailable.
  const {
    isPolling,
    pollCount,
    error: pollError,
    start: startPoll,
    stop: stopPoll,
  } = useHolderPolling(scannedMint, data, handleHolderDiff);

  useEffect(() => {
    if (liveEnabled && wsFallback && scannedMint) {
      startPoll();
    } else {
      stopPoll();
    }
  }, [liveEnabled, wsFallback, scannedMint, startPoll, stopPoll]);

  useEffect(() => {
    return () => {
      stopPoll();
      if (slotFlushTimerRef.current) clearTimeout(slotFlushTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = useCallback(async (address: string, mode: AppMode) => {
    stopPoll();
    setLiveEnabled(false); // never stream a stale mint across scans
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
    setLiveEnabled(false); // never stream a stale mint across scans
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
    setLiveEnabled(false);
    setData(null);
    setStats(null);
    setTokenSecurity(null);
    setTokenMetadata(null);
    setDetectedMode(null);
    setError(null);
    setScannedMint(null);
  }, [stopPoll]);

  const startStreaming = useCallback(() => {
    setLiveEnabled(true);
  }, []);

  const stopStreaming = useCallback(() => {
    setLiveEnabled(false);
    stopPoll();
  }, [stopPoll]);

  // Live when the SSE stream is connected OR the poll fallback is actively running.
  const liveActive = liveEnabled && (streamConnected || (wsFallback && isPolling));
  const liveConnecting = liveEnabled && !liveActive;

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
      isStreaming: liveActive,
      isConnecting: liveConnecting,
      watchedAddresses: scannedMint ? [scannedMint] : [],
      transactionCount: wsFallback ? pollCount : streamEventCount,
      transactions: [],
      error: wsFallback ? pollError : streamError,
      transport: wsFallback ? ('polling' as const) : ('laserstream' as const),
    },
    startStreaming,
    stopStreaming,
  };
}

export default useGraphData;
