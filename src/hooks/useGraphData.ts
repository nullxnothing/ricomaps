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
  HolderDelta,
  NODE_COLORS,
  SupplyConcentration,
  RugScore,
  DeployerInfo,
  CabalFingerprintResult,
} from '@/lib/types';
import { useHolderPolling } from './useHolderPolling';
import { useHolderStream } from './useHolderStream';
import { shouldFilterAddress } from '@/lib/address-utils';
import { createNode } from '@/lib/graph-utils';

// Wait this long for the live stream to connect before falling back to polling.
const STREAM_CONNECT_GRACE_MS = 6_000;
// Live-graph clutter controls: a new buyer only earns a bubble if their holding is at
// least this fraction of the current largest holder (filters dust/micro buys), and the
// graph stops adding live nodes past this cap so it stays readable. Balance updates and
// removals on existing nodes are unaffected — only brand-new tiny buyers are suppressed.
const LIVE_MIN_FRACTION_OF_TOP = 0.01; // 1% of the top holder
const MAX_LIVE_NODES = 150;
// A holder controlling more than this share of holder supply is treated as a pool/AMM,
// not a real holder — tagged distinctly so it doesn't read as a whale.
const POOL_SUPPLY_SHARE = 0.15;

export interface RecentEvent {
  id: string;          // signature+owner — stable key for the list
  owner: string;
  kind: 'buy' | 'sell' | 'out';
  ts: number;
}

const MAX_RECENT_EVENTS = 15;

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
  behavioralClustersDetected?: number;
  behaviorallyClusteredWallets?: string[];
  supplyConcentration?: SupplyConcentration;
  rugScore?: RugScore;
  cabalFingerprint?: CabalFingerprintResult;
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
  deployerInfo: DeployerInfo | null;
  detectedMode: AppMode | null;
  isLoading: boolean;
  isDetecting: boolean;
  error: string | null;
  scan: (address: string, mode: AppMode) => Promise<void>;
  scanWithAutoDetect: (address: string) => Promise<AppMode | null>;
  expandNode: (nodeId: string, mode: 'funding' | 'funded') => Promise<void>;
  reset: () => void;
  streaming: StreamingStats;
  recentEvents: RecentEvent[];
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
  const [deployerInfo, setDeployerInfo] = useState<DeployerInfo | null>(null);
  const [detectedMode, setDetectedMode] = useState<AppMode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedMint, setScannedMint] = useState<string | null>(null);

  const [liveEnabled, setLiveEnabled] = useState(false);
  const [wsFallback, setWsFallback] = useState(false);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const recentEventsRef = useRef<RecentEvent[]>([]);

  const dataRef = useRef<GraphData | null>(null);
  dataRef.current = data;

  // SSE callbacks fire outside React's render closure — read the live mint via a ref.
  const scannedMintRef = useRef<string | null>(null);
  scannedMintRef.current = scannedMint;

  // Pending deltas, coalesced and flushed once per animation frame. High-volume
  // mints can push hundreds of events/sec; batching avoids a setData-per-event storm.
  const pendingDeltasRef = useRef<HolderDelta[]>([]);
  const rafRef = useRef<number | null>(null);

  // Apply all queued deltas to the graph in a single state update.
  // - existing node, balance > 0  → update tokenAmount
  // - existing node, balance == 0 → remove node + its links
  // - new owner, balance > 0, not filtered → add holder node + link to token
  // - same-slot new buyers (2+)   → flag as a bundle
  const flushDeltas = useCallback(() => {
    rafRef.current = null;
    const batch = pendingDeltasRef.current;
    pendingDeltasRef.current = [];
    const mint = scannedMintRef.current;
    if (batch.length === 0 || !mint) return;

    // Build the live activity feed from this batch (one state update per flush).
    const events: RecentEvent[] = [];
    for (const d of batch) {
      if (shouldFilterAddress(d.owner) || d.owner === mint) continue;
      const kind: RecentEvent['kind'] = d.newBalance <= 0 ? 'out' : d.delta < 0 ? 'sell' : 'buy';
      events.push({ id: `${d.signature}:${d.owner}`, owner: d.owner, kind, ts: Date.now() });
    }
    if (events.length > 0) {
      recentEventsRef.current = [...events.reverse(), ...recentEventsRef.current].slice(0, MAX_RECENT_EVENTS);
      setRecentEvents(recentEventsRef.current);
    }

    setData(prev => {
      if (!prev) return prev;
      const nodeIndex = new Map(prev.nodes.map((n, i) => [n.id, i]));
      let nodes = prev.nodes;
      let links = prev.links;
      const removed = new Set<string>();
      const slotNewBuyers = new Map<number, string[]>();
      const bundled = new Set<string>();
      let changed = false;
      let liveNodeCount = prev.nodes.length;

      // Dust threshold: a fraction of the current largest holder's balance. New buyers
      // below this don't get a bubble (they still count via balance updates if they grow).
      const topBalance = prev.nodes.reduce(
        (m, n) => Math.max(m, n.tokenAmount || n.solBalance || 0), 0,
      );
      const minNewBuyerBalance = topBalance * LIVE_MIN_FRACTION_OF_TOP;

      const ensureNodesCopy = () => { if (nodes === prev.nodes) nodes = [...prev.nodes]; };

      for (const d of batch) {
        if (shouldFilterAddress(d.owner) || d.owner === mint) continue;
        const idx = nodeIndex.get(d.owner);

        if (idx !== undefined) {
          if (d.newBalance <= 0) {
            removed.add(d.owner);
          } else {
            ensureNodesCopy();
            nodes[idx] = { ...nodes[idx], tokenAmount: d.newBalance };
          }
          changed = true;
          continue;
        }

        // New buyer — suppress dust and stop once the graph hits its readable cap.
        if (d.newBalance <= 0 || removed.has(d.owner)) continue;
        if (d.newBalance < minNewBuyerBalance) continue;
        if (liveNodeCount >= MAX_LIVE_NODES) continue;
        const newNode = createNode(d.owner, 1, 'holder', d.newBalance);
        liveNodeCount++;
        ensureNodesCopy();
        nodeIndex.set(d.owner, nodes.length);
        nodes.push(newNode);
        if (links === prev.links) links = [...prev.links];
        links.push({ source: mint, target: d.owner, value: 0, txSignature: d.signature, timestamp: Date.now() });
        changed = true;

        if (d.slot > 0) {
          const arr = slotNewBuyers.get(d.slot) ?? [];
          arr.push(d.owner);
          slotNewBuyers.set(d.slot, arr);
        }
      }

      // Same-slot co-buys (2+ new buyers in one slot) → bundle.
      for (const owners of slotNewBuyers.values()) {
        if (owners.length >= 2) owners.forEach(o => bundled.add(o));
      }
      if (bundled.size > 0) {
        ensureNodesCopy();
        for (let i = 0; i < nodes.length; i++) {
          if (bundled.has(nodes[i].id) && nodes[i].type !== 'bundled') {
            nodes[i] = { ...nodes[i], type: 'bundled', color: NODE_COLORS.bundled,
              metadata: { ...nodes[i].metadata, suspicious: true, isBundled: true } };
          }
        }
      }

      // Re-tag any node that has grown past the pool share as a pool/AMM (a live
      // balance update can push a holder over the line, e.g. the AMM accumulating).
      if (changed) {
        const supplyTotal = nodes.reduce(
          (s, n) => (n.type === 'token' ? s : s + (n.tokenAmount || n.solBalance || 0)), 0,
        );
        if (supplyTotal > 0) {
          ensureNodesCopy();
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n.type === 'token' || n.type === 'pool') continue;
            const share = (n.tokenAmount || n.solBalance || 0) / supplyTotal;
            if (share > POOL_SUPPLY_SHARE) {
              nodes[i] = { ...n, type: 'pool', color: NODE_COLORS.pool,
                metadata: { ...n.metadata, isPool: true } };
            }
          }
        }
      }

      if (removed.size > 0) {
        nodes = (nodes === prev.nodes ? [...prev.nodes] : nodes).filter(n => !removed.has(n.id));
        links = (links === prev.links ? prev.links : links).filter(
          l => !removed.has(endpointId(l.source)) && !removed.has(endpointId(l.target)),
        );
      }

      if (!changed) return prev;
      setStats(s => ({ ...s, nodesFound: nodes.length, linksFound: links.length }));
      return { nodes, links };
    });
  }, []);

  const enqueueDelta = useCallback((delta: HolderDelta) => {
    pendingDeltasRef.current.push(delta);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushDeltas);
    }
  }, [flushDeltas]);

  // Live stream handler — queue one delta from the LaserStream worker.
  const handleHolderDelta = useCallback((delta: HolderDelta) => {
    enqueueDelta(delta);
  }, [enqueueDelta]);

  // Poll fallback handler — adapt {added, removed, changed} into per-owner deltas
  // and run them through the SAME queue so behaviour matches the live path.
  const handleHolderDiff = useCallback(
    (diff: { added: { owner: string; amount: number }[]; removed: string[]; changed: { owner: string; amount: number }[] }) => {
      for (const h of diff.changed) enqueueDelta({ owner: h.owner, newBalance: h.amount, delta: 0, slot: 0, signature: '' });
      for (const h of diff.added) enqueueDelta({ owner: h.owner, newBalance: h.amount, delta: h.amount, slot: 0, signature: '' });
      for (const owner of diff.removed) enqueueDelta({ owner, newBalance: 0, delta: 0, slot: 0, signature: '' });
    },
    [enqueueDelta]
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
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
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
      setDeployerInfo(result.deployerInfo || null);
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

    // Progressive paint: fire a fast quick-scan (15 holders, cache-first) in parallel
    // with the authoritative scan. If the quick result lands first, paint it so the
    // graph appears fast; the full /api/scan result always wins once it resolves and
    // is merged incrementally by BubbleMap (high node overlap → no relayout).
    let fullResolved = false;
    const quickScan = fetch('/api/v1/quick-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    })
      .then(r => r.json())
      .then((quick: ScanResponse) => {
        if (fullResolved || !quick.success || !quick.data) return;
        setData(quick.data);
        setStats(quick.stats || null);
        setTokenSecurity(quick.tokenSecurity || null);
        setTokenMetadata(quick.tokenMetadata || null);
        setDeployerInfo(quick.deployerInfo || null);
        setDetectedMode('token'); // quick-scan only returns token graphs
        setScannedMint(address);
      })
      .catch(() => {}); // best-effort; ignore (e.g. it's a wallet, not a token)

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      const result: ScanResponse = await response.json();
      fullResolved = true;
      void quickScan;

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Scan failed');
      }

      setData(result.data);
      setStats(result.stats || null);
      setTokenSecurity(result.tokenSecurity || null);
      setTokenMetadata(result.tokenMetadata || null);
      setDeployerInfo(result.deployerInfo || null);
      setDetectedMode(result.mode || null);

      // Store mint for polling (only for token mode)
      if (result.mode === 'token') {
        setScannedMint(address);
      } else {
        setScannedMint(null); // wallet mode — discard any quick-scan mint
      }

      return result.mode || null;
    } catch (err) {
      fullResolved = true;
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
    setDeployerInfo(null);
    setDetectedMode(null);
    setError(null);
    setScannedMint(null);
    recentEventsRef.current = [];
    setRecentEvents([]);
  }, [stopPoll]);

  const startStreaming = useCallback(() => {
    recentEventsRef.current = [];
    setRecentEvents([]);
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
    deployerInfo,
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
    recentEvents,
    startStreaming,
    stopStreaming,
  };
}

export default useGraphData;
