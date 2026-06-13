'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { GraphNode, GraphData } from '@/lib/types';
import { AddressInput } from '@/components/AddressInput';
import { type StatsFilter } from '@/components/StatsPanel';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { TrendingTokens } from '@/components/TrendingTokens';
import { NodeDetailPanel } from '@/components/NodeDetailPanel';
import { WalletSidebar } from '@/components/WalletSidebar';
import { useGraphData } from '@/hooks/useGraphData';
import { isValidSolanaAddress, truncateAddress } from '@/lib/address-utils';
import { CrossTokenPanel } from '@/components/CrossTokenPanel';
import { HistoricalSnapshot, snapshotToGraphData } from '@/lib/snapshot-to-graph';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LiveActivityFeed } from '@/components/LiveActivityFeed';
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { useGateContext } from '@/components/GateProvider';
import { TopBar } from '@/components/app/TopBar';
import { ControlDock, type RenderMode } from '@/components/app/ControlDock';
import { TokenIdentityRail } from '@/components/app/TokenIdentityRail';
import { RiskRail } from '@/components/app/RiskRail';
import { GraphLegend } from '@/components/app/GraphLegend';
import { GraphAIPanel } from '@/components/app/GraphAIPanel';
import type { BubbleMapHandle } from '@/components/BubbleMap';

const BubbleMap = dynamic(
  () => import('@/components/BubbleMap').then((mod) => mod.BubbleMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-bg-void">
        <div className="spinner-lg" />
      </div>
    ),
  }
);

/**
 * Cluster stats for the rail's "Clusters N (max M)" row. Union-find over graph
 * links (same grouping the BubbleMap dashed hulls use); singletons are ignored so
 * the count reflects real multi-wallet crews.
 */
function clusterStats(data: GraphData): { clusterCount: number; maxClusterSize: number } {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const n of data.nodes) if (!parent.has(n.id)) parent.set(n.id, n.id);
  for (const l of data.links) {
    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
    if (parent.has(s) && parent.has(t)) union(s, t);
  }
  const sizes = new Map<string, number>();
  for (const n of data.nodes) {
    if (n.type === 'token' || n.type === 'pool') continue;
    const root = find(n.id);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  let clusterCount = 0, maxClusterSize = 0;
  for (const size of sizes.values()) {
    if (size >= 2) { clusterCount++; maxClusterSize = Math.max(maxClusterSize, size); }
  }
  return { clusterCount, maxClusterSize };
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-void" />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const { unlocked: gateUnlocked, unlock: gateUnlock } = useGateContext();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [clipboardAddress, setClipboardAddress] = useState<string | null>(null);
  const autoScannedRef = useRef(false);
  const [scannedAddress, setScannedAddress] = useState<string | null>(null);
  const [deepScanOpen, setDeepScanOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [historicalSnapshot, setHistoricalSnapshot] = useState<HistoricalSnapshot | null>(null);
  const [graphFilter, setGraphFilter] = useState<StatsFilter>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Redesign shell state: render mode, AI panel, zoom %, mobile rail overlays.
  const [renderMode, setRenderMode] = useState<RenderMode>('default');
  const [aiOpen, setAiOpen] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [leftRailOpen, setLeftRailOpen] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(false);
  const bubbleRef = useRef<BubbleMapHandle>(null);
  const {
    data,
    stats,
    tokenSecurity,
    tokenMetadata,
    deployerInfo,
    detectedMode,
    isLoading,
    isDetecting,
    error,
    scanWithAutoDetect,
    expandNode,
    reset,
    streaming,
    recentEvents,
    startStreaming,
    stopStreaming,
  } = useGraphData();

  // Cluster count + largest-cluster size for the risk rail's "Clusters" row.
  const clusters = useMemo(() => (data ? clusterStats(data) : { clusterCount: 0, maxClusterSize: 0 }), [data]);

  useEffect(() => {
    async function checkClipboard() {
      try {
        if (!navigator.clipboard?.readText) return;
        const text = await navigator.clipboard.readText();
        const trimmed = text?.trim();
        if (trimmed && isValidSolanaAddress(trimmed)) {
          setClipboardAddress(trimmed);
        }
      } catch {
        // Clipboard access denied
      }
    }
    checkClipboard();
  }, []);

  // Auto-scan from URL param: ?address=xxx (blacklist) or ?mint=xxx (Telegram bot deep links)
  useEffect(() => {
    const addressParam = searchParams.get('address') ?? searchParams.get('mint');
    if (addressParam && isValidSolanaAddress(addressParam) && !autoScannedRef.current && !data) {
      autoScannedRef.current = true;
      scanWithAutoDetect(addressParam);
    }
  }, [searchParams, data, scanWithAutoDetect]);

  const handleScan = useCallback(async (address: string) => {
    reset();
    setSelectedNode(null);
    setHistoricalSnapshot(null);
    setClipboardAddress(null);
    setScannedAddress(address);
    setGraphFilter(null);
    await scanWithAutoDetect(address);
  }, [scanWithAutoDetect, reset]);

  const handleTokenClick = useCallback(async (address: string) => {
    reset();
    setSelectedNode(null);
    setHistoricalSnapshot(null);
    setScannedAddress(address);
    setGraphFilter(null);
    await scanWithAutoDetect(address);
  }, [scanWithAutoDetect, reset]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    setSelectedWallet(node.id);
  }, []);

  const handleTraceFunders = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    setSelectedWallet(node.id);
    expandNode(node.id, 'funding');
  }, [expandNode]);

  // Esc closes open panels / clears the current selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSelectedNode(null);
      setSelectedWallet(null);
      setDeepScanOpen(false);
      setAiOpen(false);
      setLeftRailOpen(false);
      setRightRailOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleBack = useCallback(() => {
    reset();
    setSelectedNode(null);
    setAiOpen(false);
    setRenderMode('default');
  }, [reset]);

  const handleShare = useCallback(() => {
    if (!scannedAddress) return;
    navigator.clipboard.writeText(`${window.location.origin}/?address=${scannedAddress}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [scannedAddress]);

  // Go-Live: spawn a pulse ring on the graph for each new streamed event.
  const lastEventCountRef = useRef(0);
  useEffect(() => {
    if (!streaming.isStreaming) { lastEventCountRef.current = recentEvents.length; return; }
    const delta = recentEvents.length - lastEventCountRef.current;
    for (let i = 0; i < Math.min(delta, 4); i++) bubbleRef.current?.pulseRandom();
    lastEventCountRef.current = recentEvents.length;
  }, [recentEvents, streaming.isStreaming]);

  const toggleLive = useCallback(() => {
    if (streaming.isStreaming || streaming.isConnecting) stopStreaming();
    else startStreaming();
  }, [streaming.isStreaming, streaming.isConnecting, startStreaming, stopStreaming]);

  // Compute effective graph data: historical snapshot or live data
  const effectiveData: GraphData | null = useMemo(() => {
    if (!data) return null;
    if (historicalSnapshot && detectedMode === 'token' && scannedAddress) {
      return snapshotToGraphData(historicalSnapshot, scannedAddress, tokenMetadata?.name, data);
    }
    return data;
  }, [data, historicalSnapshot, detectedMode, scannedAddress, tokenMetadata?.name]);

  const currentSelectedNode = useMemo(() => {
    if (!selectedNode) return null;
    return effectiveData?.nodes.find(n => n.id === selectedNode.id) ?? selectedNode;
  }, [effectiveData, selectedNode]);

  // Graph View — structured app shell: top bar · left rail · graph · right rail · dock.
  if (data) {
    const isToken = detectedMode === 'token';
    const cabalWallets = data.nodes.filter(n => n.type === 'cabal-funder').map(n => n.id);

    return (
      <div className="app-shell">
        <LoadingOverlay isLoading={isLoading} mode={detectedMode || 'wallet'} />

        <TopBar
          active="token"
          onScan={handleScan}
          isLoading={isLoading}
          isDetecting={isDetecting}
          onBack={handleBack}
          onShare={handleShare}
          shareCopied={linkCopied}
        />

        <div className="app-body">
          {/* Left rail — token identity (overlay on mobile) */}
          {isToken && tokenMetadata && (
            <>
              {leftRailOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setLeftRailOpen(false)} />}
              <TokenIdentityRail
                metadata={tokenMetadata}
                security={tokenSecurity}
                rugScore={stats?.rugScore}
                address={scannedAddress}
                className={`${leftRailOpen ? 'rail--overlay flex' : 'hidden'} lg:flex`}
              />
            </>
          )}

          {/* Center stage — graph on the technical grid */}
          <main className="app-stage">
            <ErrorBoundary
              resetKey={scannedAddress ?? ''}
              fallback={(err, retry) => (
                <div className="w-full h-full flex items-center justify-center p-4">
                  <div className="glass-panel-danger p-5 max-w-md text-center">
                    <p className="text-sm font-semibold text-text-primary mb-2">Graph failed to render</p>
                    <p className="text-[11px] font-mono text-text-tertiary mb-4 break-words">{err.message}</p>
                    <button onClick={retry} className="btn-primary text-[11px] px-3 py-1.5">Retry graph</button>
                  </div>
                </div>
              )}
            >
              <div className="absolute inset-0" style={historicalSnapshot ? { boxShadow: 'inset 0 0 0 2px rgba(245,158,11,0.3)' } : undefined}>
                <BubbleMap
                  ref={bubbleRef}
                  data={effectiveData || data}
                  onNodeClick={handleNodeClick}
                  onTraceFunders={handleTraceFunders}
                  filter={graphFilter}
                  mode={renderMode}
                  onZoomChange={setZoomPct}
                  totalSupply={stats?.supplyConcentration?.totalMintSupply}
                />
              </div>
            </ErrorBoundary>

            {/* Legend (top-left) + hint (top-right) */}
            {isToken && (
              <div className="absolute top-3 left-3 z-10 hidden md:block">
                <GraphLegend />
              </div>
            )}
            <div className="absolute top-3 right-3 z-10 hidden md:block font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-faint select-none">
              drag bubbles · scroll to zoom
            </div>

            {/* Mobile rail toggles */}
            {isToken && tokenMetadata && (
              <button className="absolute top-3 left-3 z-10 lg:hidden glass-legend !p-2" onClick={() => setLeftRailOpen(true)} aria-label="Token info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              </button>
            )}
            {isToken && stats && (
              <button className="absolute top-3 right-3 z-10 lg:hidden glass-legend !p-2" onClick={() => setRightRailOpen(true)} aria-label="Risk analysis">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary"><path d="M3 12h4l3-9 4 18 3-9h4" /></svg>
              </button>
            )}

            {/* Historical mode indicator */}
            {historicalSnapshot && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-mono bg-amber-ghost text-amber-primary border border-amber-primary/20">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {new Date(historicalSnapshot.blockTime * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
              </div>
            )}

            {error && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-md w-[calc(100%-2rem)]">
                <div className="glass-panel-danger p-3"><p className="text-sm text-red-primary">{error}</p></div>
              </div>
            )}

            {/* Sparse results overlay */}
            {data.nodes.length <= 1 && data.links.length === 0 && !isLoading && (
              <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
                <div className="text-center px-7 py-6 rounded-xl max-w-sm bg-black/90 border border-white/[0.06] backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-text-tertiary">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /><path d="M8 11h6" />
                  </svg>
                  <p className="text-sm font-medium mb-1.5 text-text-secondary">No connections detected</p>
                  <p className="text-xs leading-relaxed text-text-tertiary">
                    {detectedMode === 'wallet'
                      ? 'This wallet has no traceable funding sources in its recent transaction history.'
                      : 'No shared funding connections found among top holders.'}
                  </p>
                </div>
              </div>
            )}

            {/* Live activity feed (when streaming) */}
            {isToken && streaming.isStreaming && recentEvents.length > 0 && (
              <div className="absolute bottom-[72px] left-3 z-10 hidden md:block">
                <LiveActivityFeed events={recentEvents} />
              </div>
            )}

            {/* AI read panel (toggled from dock) */}
            {isToken && stats && (
              <div className="absolute bottom-[72px] left-1/2 -translate-x-1/2 z-20">
                <GraphAIPanel
                  open={aiOpen}
                  onClose={() => setAiOpen(false)}
                  mint={scannedAddress}
                  data={data}
                  stats={stats || undefined}
                  tokenMetadata={tokenMetadata}
                  deployerInfo={deployerInfo}
                />
              </div>
            )}

            {/* Node detail panel (bottom-left) */}
            {currentSelectedNode && (
              <div className="absolute bottom-[72px] left-3 z-20" style={{ animation: 'slideUp 0.2s ease-out' }}>
                <NodeDetailPanel
                  node={currentSelectedNode}
                  onClose={() => setSelectedNode(null)}
                  onExpandFunding={!currentSelectedNode.expanded && currentSelectedNode.type !== 'token' ? () => expandNode(currentSelectedNode.id, 'funding') : undefined}
                  onExpandFunded={currentSelectedNode.type !== 'token' ? () => expandNode(currentSelectedNode.id, 'funded') : undefined}
                  isLoading={isLoading}
                />
              </div>
            )}

            {/* Deep Scan (bottom-right) when cabal funders exist */}
            {cabalWallets.length > 0 && (
              <>
                <ShimmerButton
                  className="absolute bottom-[72px] right-3 z-10 px-3.5 py-2 text-xs font-medium text-red-primary"
                  background="rgba(20, 5, 8, 0.95)"
                  shimmerColor="#ef4444"
                  borderRadius="8px"
                  shimmerDuration="2.5s"
                  onClick={async () => {
                    if (!gateUnlocked) {
                      const ok = await gateUnlock();
                      if (!ok) return;
                    }
                    const cost = cabalWallets.length * 100;
                    if (window.confirm(`This will analyze ${cabalWallets.length} cabal wallets across all their token holdings.\nEstimated cost: ~${cost} credits.\n\nContinue?`)) {
                      setDeepScanOpen(true);
                    }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /><path d="M11 8v6M8 11h6" />
                  </svg>
                  Deep Scan ({cabalWallets.length})
                </ShimmerButton>
                <CrossTokenPanel isOpen={deepScanOpen} onClose={() => setDeepScanOpen(false)} cabalWallets={cabalWallets} />
              </>
            )}

            {/* Control dock (bottom-center) */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100vw-1.5rem)] overflow-x-auto">
              <ControlDock
                isLive={streaming.isStreaming}
                liveCount={streaming.transactionCount}
                liveBusy={streaming.isConnecting}
                onToggleLive={toggleLive}
                aiOpen={aiOpen}
                onToggleAi={() => setAiOpen(o => !o)}
                mode={renderMode}
                onSetMode={setRenderMode}
                zoomPct={zoomPct}
                onZoomIn={() => bubbleRef.current?.zoomIn()}
                onZoomOut={() => bubbleRef.current?.zoomOut()}
                onFit={() => bubbleRef.current?.fit()}
                onExportPng={() => bubbleRef.current?.exportPng()}
                onExportCsv={() => bubbleRef.current?.exportCsv()}
              />
            </div>
          </main>

          {/* Right rail — risk (overlay on mobile) */}
          {isToken && stats && (
            <>
              {rightRailOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setRightRailOpen(false)} />}
              <RiskRail
                data={data}
                rugScore={stats.rugScore}
                supply={stats.supplyConcentration}
                tokenSecurity={tokenSecurity}
                deployer={deployerInfo}
                meta={{
                  analyzedHolders: stats.analyzedHolders,
                  totalHolders: stats.totalHolders,
                  clusterCount: clusters.clusterCount,
                  maxClusterSize: clusters.maxClusterSize,
                }}
                className={`${rightRailOpen ? 'rail--overlay flex' : 'hidden'} lg:flex`}
              />
            </>
          )}
        </div>

        <WalletSidebar
          address={selectedWallet}
          onClose={() => setSelectedWallet(null)}
          graphNodes={data?.nodes || []}
        />
      </div>
    );
  }

  // Landing Page
  return (
    <main className="relative min-h-screen overflow-hidden bg-bg-void">
      <Navbar fadeIn />
      {/* Radial glow: centered on hero */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: 'radial-gradient(ellipse 900px 600px at 50% 28%, rgba(0,255,65,0.04) 0%, transparent 70%)',
        }}
      />
      {/* Scanline overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.006) 2px, rgba(0,255,65,0.006) 4px)',
        }}
      />

      <LoadingOverlay isLoading={isLoading || isDetecting} mode={detectedMode || 'wallet'} />

      <div className="relative z-10 flex flex-col items-center pt-12 sm:pt-16 pb-10 px-4 sm:px-6 text-center">
        {/* Stacked identity */}
        <div className="flex flex-col items-center gap-4 mb-6 sm:mb-8">
          <img
            src="/favicon.png"
            alt="RicoMaps"
            className="w-14 h-14 sm:w-18 sm:h-18 rounded-2xl border border-white/[0.08] shadow-[0_0_32px_rgba(0,255,65,0.12),0_8px_24px_rgba(0,0,0,0.4)]"
          />
          <div>
            <h1 className="text-3xl sm:text-[2.5rem] font-bold tracking-tight leading-none mb-1 text-text-primary" style={{ letterSpacing: '-0.03em' }}>
              RicoMaps
            </h1>
            <AnimatedShinyText className="text-[10px] font-mono font-semibold tracking-[0.18em] uppercase text-text-tertiary mx-0 max-w-none">
              Solana Forensic Intelligence
            </AnimatedShinyText>
          </div>
        </div>

        <p className="text-[13px] mb-8 sm:mb-10 max-w-[420px] font-mono text-text-tertiary leading-[1.7]">
          Trace wallet funding chains and expose hidden cabal connections on Solana
        </p>

        <div className="w-full max-w-xl mb-4 px-1">
          <AddressInput onSubmit={handleScan} isLoading={isLoading} isDetecting={isDetecting} size="large" />
        </div>

        {!clipboardAddress && !isLoading && !isDetecting && (
          <p className="mt-1 text-[11px] font-mono text-text-tertiary">
            Paste a token or wallet to map it, or{' '}
            <button
              onClick={() => handleTokenClick('8AuS5e8cnsfDT77AhirQWY6q8SW2ogZGLg7QCVWPfBCJ')}
              className="text-green-primary/80 hover:text-green-primary underline underline-offset-2 transition-colors"
            >
              try an example
            </button>
          </p>
        )}

        {clipboardAddress && !isLoading && !isDetecting && (
          <button
            className="mt-3 flex items-center gap-2 px-3.5 py-1.5 text-[11px] font-mono font-medium tracking-[0.02em] transition-all duration-150 rounded-[5px] bg-green-primary/[0.04] hover:bg-green-primary/[0.08] border border-green-primary/15 hover:border-green-primary/30 text-text-tertiary hover:text-green-primary"
            onClick={() => handleScan(clipboardAddress)}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            Scan {truncateAddress(clipboardAddress, 4)} from clipboard
          </button>
        )}

        {error && (
          <div className="glass-panel-danger p-3 mt-4 max-w-md w-full">
            <p className="text-sm text-red-primary">{error}</p>
          </div>
        )}
      </div>

      <TrendingTokens onTokenClick={handleTokenClick} />

      <div className="relative z-10 mt-16">
        <Footer />
      </div>
    </main>
  );
}
