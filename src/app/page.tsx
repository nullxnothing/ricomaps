'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { GraphNode, GraphData } from '@/lib/types';
import { AddressInput } from '@/components/AddressInput';
import { StatsPanel, type StatsFilter } from '@/components/StatsPanel';
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
import { AnimatedShinyText } from '@/components/ui/animated-shiny-text';
import { ShimmerButton } from '@/components/ui/shimmer-button';

function formatCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

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

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-void" />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [clipboardAddress, setClipboardAddress] = useState<string | null>(null);
  const autoScannedRef = useRef(false);
  const [statsPanelOpen, setStatsPanelOpen] = useState(false);
  const [scannedAddress, setScannedAddress] = useState<string | null>(null);
  const [deepScanOpen, setDeepScanOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [historicalSnapshot, setHistoricalSnapshot] = useState<HistoricalSnapshot | null>(null);
  const [graphFilter, setGraphFilter] = useState<StatsFilter>(null);
  const {
    data,
    stats,
    tokenSecurity,
    tokenMetadata,
    detectedMode,
    isLoading,
    isDetecting,
    error,
    scanWithAutoDetect,
    expandNode,
    reset,
  } = useGraphData();

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

  // Auto-scan from URL param (e.g., /?address=xxx from blacklist)
  useEffect(() => {
    const addressParam = searchParams.get('address');
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

  const handleBack = useCallback(() => {
    reset();
    setSelectedNode(null);
  }, [reset]);

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

  // Graph View
  if (data) {
    return (
      <main className="relative w-screen h-screen overflow-hidden bg-bg-void">
        <LoadingOverlay isLoading={isLoading} mode={detectedMode || 'wallet'} />

        {/* Nav Bar — full width to match marketing pages */}
        <header className="absolute top-0 left-0 right-0 z-10 h-[52px] glass-panel-floating border-t-0 border-x-0 border-b border-border-base">
          <div className="w-full px-5 sm:px-8 h-full flex items-center gap-4">
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <button onClick={handleBack} className="btn-back" title="Back">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <div className="flex items-center gap-2 select-none">
                <img src="/favicon.png" alt="" className="w-6 h-6 rounded-md border border-white/10" />
                <span className="text-sm font-bold tracking-tight hidden sm:inline text-text-primary">RicoMaps</span>
              </div>
            </div>
            <div className="flex-1 max-w-md mx-auto">
              <AddressInput onSubmit={handleScan} isLoading={isLoading} isDetecting={isDetecting} />
            </div>
            <div className="w-[80px] flex-shrink-0 hidden md:block" />
          </div>
        </header>

        {/* Token identity card — floating below nav */}
        {detectedMode === 'token' && tokenMetadata && (
          <div className="absolute top-[56px] left-3 sm:left-4 z-10 w-[220px] sm:w-[260px] xl:w-[280px] overflow-hidden rounded-lg glass-panel">
            {/* Header: image + name + symbol */}
            <div className="flex items-center gap-2.5 px-3 pt-3 pb-2">
              {tokenMetadata.image && (
                <img
                  src={tokenMetadata.image.startsWith('https://') ? tokenMetadata.image : ''}
                  alt=""
                  className="w-9 h-9 rounded-lg flex-shrink-0 object-cover border border-white/10"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate leading-tight text-text-primary">
                  {tokenMetadata.name || 'Unknown'}
                </div>
                {tokenMetadata.symbol && (
                  <div className="text-[11px] leading-tight text-text-tertiary">${tokenMetadata.symbol}</div>
                )}
              </div>
            </div>

            {/* Security badges */}
            {tokenSecurity && (
              <div className="flex items-center gap-1 px-3 pb-2 flex-wrap">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${tokenSecurity.hasFreezeAuthority ? 'bg-red-ghost text-red-primary' : 'bg-green-ghost text-green-primary'}`}>
                  {tokenSecurity.hasFreezeAuthority ? 'Freeze' : 'No Freeze'}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${tokenSecurity.hasMintAuthority ? 'bg-amber-ghost text-amber-primary' : 'bg-green-ghost text-green-primary'}`}>
                  {tokenSecurity.hasMintAuthority ? 'Mintable' : 'No Mint'}
                </span>
                {tokenSecurity.isMutable && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-ghost text-amber-primary">
                    Mutable
                  </span>
                )}
              </div>
            )}

            {/* Market data */}
            {(tokenMetadata.priceUsd != null || tokenMetadata.marketCap != null) && (
              <div className="px-3 pb-2 pt-2 space-y-1 border-t border-border-base">
                {tokenMetadata.priceUsd != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-tertiary">Price</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-mono font-semibold text-text-primary">
                        ${tokenMetadata.priceUsd < 0.001
                          ? tokenMetadata.priceUsd.toExponential(2)
                          : tokenMetadata.priceUsd < 1
                            ? tokenMetadata.priceUsd.toFixed(6)
                            : tokenMetadata.priceUsd.toFixed(4)}
                      </span>
                      {tokenMetadata.priceChange24h != null && (
                        <span className={`text-[10px] font-mono ${tokenMetadata.priceChange24h >= 0 ? 'text-green-primary' : 'text-red-primary'}`}>
                          {tokenMetadata.priceChange24h >= 0 ? '+' : ''}{tokenMetadata.priceChange24h.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {tokenMetadata.marketCap != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-tertiary">Mkt Cap</span>
                    <span className="text-[11px] font-mono text-text-secondary">{formatCompact(tokenMetadata.marketCap)}</span>
                  </div>
                )}
                {tokenMetadata.volume24h != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-tertiary">Vol 24h</span>
                    <span className="text-[11px] font-mono text-text-secondary">{formatCompact(tokenMetadata.volume24h)}</span>
                  </div>
                )}
                {tokenMetadata.liquidity != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-tertiary">Liquidity</span>
                    <span className="text-[11px] font-mono text-text-secondary">{formatCompact(tokenMetadata.liquidity)}</span>
                  </div>
                )}
                {tokenMetadata.fdv != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-tertiary">FDV</span>
                    <span className="text-[11px] font-mono text-text-secondary">{formatCompact(tokenMetadata.fdv)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            {tokenMetadata.description && (
              <div className="px-3 pb-2 pt-2 border-t border-border-base">
                <p className="text-[10px] leading-relaxed line-clamp-3 text-text-tertiary">
                  {tokenMetadata.description}
                </p>
              </div>
            )}

            {/* CA — click to copy */}
            {scannedAddress && (
              <button
                className="flex items-center justify-between w-full px-3 py-2 transition-colors duration-150 group bg-transparent border-t border-border-base"
                onClick={() => { navigator.clipboard.writeText(scannedAddress); }}
                title="Copy contract address"
              >
                <span className="text-[10px] font-mono text-text-tertiary">{truncateAddress(scannedAddress, 6)}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
              </button>
            )}

            {/* Social / external links */}
            {(tokenMetadata.website || tokenMetadata.twitter || tokenMetadata.telegram || tokenMetadata.discord || tokenMetadata.dexUrl) && (
              <div className="flex items-center gap-1 px-3 pb-3 pt-2 border-t border-border-base">
                {tokenMetadata.website && (
                  <a href={tokenMetadata.website} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 bg-bg-elevated text-text-tertiary hover:text-text-primary"
                    title="Website"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>
                    </svg>
                  </a>
                )}
                {tokenMetadata.twitter && (
                  <a href={tokenMetadata.twitter.startsWith('http') ? tokenMetadata.twitter : `https://x.com/${tokenMetadata.twitter}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 bg-bg-elevated text-text-tertiary hover:text-text-primary"
                    title="Twitter / X"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </a>
                )}
                {tokenMetadata.telegram && (
                  <a href={tokenMetadata.telegram.startsWith('http') ? tokenMetadata.telegram : `https://t.me/${tokenMetadata.telegram}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 bg-bg-elevated text-text-tertiary hover:text-text-primary"
                    title="Telegram"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                    </svg>
                  </a>
                )}
                {tokenMetadata.discord && (
                  <a href={tokenMetadata.discord} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 bg-bg-elevated text-text-tertiary hover:text-text-primary"
                    title="Discord"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028 14.09 14.09 0 001.226-1.994.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z"/>
                    </svg>
                  </a>
                )}
                {tokenMetadata.dexUrl && (
                  <a href={tokenMetadata.dexUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 bg-bg-elevated text-text-tertiary hover:text-text-primary"
                    title="DexScreener"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Wallet mode card */}
        {detectedMode === 'wallet' && scannedAddress && (
          <div className="absolute top-[56px] left-3 sm:left-4 z-10 overflow-hidden px-3.5 py-2 rounded-md glass-panel">
            <span className="text-[11px] font-mono text-text-secondary">
              {truncateAddress(scannedAddress, 8)}
            </span>
          </div>
        )}

        {error && (
          <div className="absolute left-2 right-2 sm:left-4 sm:right-4 z-10" style={{ top: 'var(--panel-top)' }}>
            <div className="glass-panel-danger p-3">
              <p className="text-sm text-red-primary">{error}</p>
            </div>
          </div>
        )}

        {/* Historical mode indicator */}
        {historicalSnapshot && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-mono transition-all duration-200 bg-amber-ghost text-amber-primary border border-amber-primary/20 shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
            style={{ top: 'var(--panel-top)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Viewing: {new Date(historicalSnapshot.blockTime * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
          </div>
        )}

        {/* Bubble Map — use absolute instead of fixed to avoid Safari issues */}
        <div
          className="absolute inset-0 z-0"
          style={historicalSnapshot ? { boxShadow: 'inset 0 0 0 2px rgba(245,158,11,0.3)' } : undefined}
        >
          <ErrorBoundary
            resetKey={scannedAddress ?? ''}
            fallback={(error, reset) => (
              <div className="w-full h-full flex items-center justify-center p-4 bg-bg-void">
                <div className="glass-panel-danger p-5 max-w-md text-center">
                  <p className="text-sm font-semibold text-text-primary mb-2">Graph failed to render</p>
                  <p className="text-[11px] font-mono text-text-tertiary mb-4 break-words">{error.message}</p>
                  <button onClick={reset} className="btn-primary text-[11px] px-3 py-1.5">Retry graph</button>
                </div>
              </div>
            )}
          >
            <BubbleMap data={effectiveData || data} onNodeClick={handleNodeClick} filter={graphFilter} />
          </ErrorBoundary>
        </div>

        {/* Sparse results overlay — shown when only 1 node with no links */}
        {data.nodes.length <= 1 && data.links.length === 0 && !isLoading && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
            <div className="text-center px-7 py-6 rounded-xl max-w-sm bg-black/90 border border-white/[0.06] backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-text-tertiary">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
                <path d="M8 11h6" />
              </svg>
              <p className="text-sm font-medium mb-1.5 text-text-secondary">No connections detected</p>
              <p className="text-xs leading-relaxed text-text-tertiary">
                {detectedMode === 'wallet'
                  ? 'This wallet has no traceable funding sources in its recent transaction history.'
                  : 'No shared funding connections found among top holders.'
                }
              </p>
            </div>
          </div>
        )}

        {/* Stats toggle button — mobile only */}
        <button
          className={`absolute right-3 z-10 md:hidden glass-panel p-2 rounded-lg transition-all duration-150 ${statsPanelOpen ? 'bg-green-primary/10' : ''}`}
          style={{ top: 'var(--panel-top)' }}
          onClick={() => setStatsPanelOpen(!statsPanelOpen)}
          aria-label="Toggle stats panel"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={statsPanelOpen ? 'text-green-primary' : 'text-text-tertiary'}>
            <path d="M3 12h4l3-9 4 18 3-9h4" />
          </svg>
        </button>

        {/* Stats — desktop: fixed right side, mobile: bottom sheet overlay */}
        <div className={`
          absolute z-10
          md:right-3 md:block
          ${statsPanelOpen
            ? 'bottom-0 left-0 right-0 md:bottom-auto md:left-auto'
            : 'hidden md:block md:right-3'
          }
        `} style={{ top: 'var(--panel-top)' }}>
          {/* Mobile backdrop */}
          {statsPanelOpen && (
            <div
              className="fixed inset-0 bg-black/40 md:hidden"
              onClick={() => setStatsPanelOpen(false)}
            />
          )}
          {/* Mobile grab handle */}
          <div className="relative md:hidden">
            {statsPanelOpen && (
              <div
                className="flex justify-center py-2 cursor-pointer bg-bg-elevated border-t border-border-base rounded-t-xl"
                onClick={() => setStatsPanelOpen(false)}
              >
                <div className="w-10 h-1 rounded-full bg-border-hover" />
              </div>
            )}
          </div>
          <StatsPanel
            data={data}
            mode={detectedMode || 'wallet'}
            stats={stats || undefined}
            tokenSecurity={tokenSecurity}
            onFilter={setGraphFilter}
            activeFilter={graphFilter}
          />
        </div>

        {/* Detail Panel — full-width bottom on mobile */}
        {currentSelectedNode && (
          <div
            className="absolute bottom-0 left-0 right-0 sm:bottom-4 sm:left-4 sm:right-auto z-10"
            style={{ animation: 'slideUp 0.2s ease-out' }}
          >
            <NodeDetailPanel
              node={currentSelectedNode}
              onClose={() => setSelectedNode(null)}
              onExpandFunding={!currentSelectedNode.expanded && currentSelectedNode.type !== 'token' ? () => expandNode(currentSelectedNode.id, 'funding') : undefined}
              onExpandFunded={currentSelectedNode.type !== 'token' ? () => expandNode(currentSelectedNode.id, 'funded') : undefined}
              isLoading={isLoading}
            />
          </div>
        )}

        {/* Deep Scan button — only visible when cabal funders exist */}
        {(() => {
          const cabalWallets = data.nodes.filter(n => n.type === 'cabal-funder').map(n => n.id);
          if (cabalWallets.length === 0) return null;
          return (
            <>
              <ShimmerButton
                className="absolute bottom-4 right-4 z-10 px-3.5 py-2 text-xs font-medium text-red-primary"
                background="rgba(20, 5, 8, 0.95)"
                shimmerColor="#ef4444"
                borderRadius="8px"
                shimmerDuration="2.5s"
                onClick={() => {
                  const cost = cabalWallets.length * 100;
                  if (window.confirm(`This will analyze ${cabalWallets.length} cabal wallets across all their token holdings.\nEstimated cost: ~${cost} credits.\n\nContinue?`)) {
                    setDeepScanOpen(true);
                  }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                  <path d="M11 8v6M8 11h6" />
                </svg>
                Deep Scan ({cabalWallets.length})
              </ShimmerButton>
              <CrossTokenPanel
                isOpen={deepScanOpen}
                onClose={() => setDeepScanOpen(false)}
                cabalWallets={cabalWallets}
              />
            </>
          );
        })()}

        <WalletSidebar
          address={selectedWallet}
          onClose={() => setSelectedWallet(null)}
          graphNodes={data?.nodes || []}
        />
      </main>
    );
  }

  // Landing Page
  return (
    <main className="relative min-h-screen overflow-hidden bg-bg-void">
      <Navbar fadeIn />
      {/* Radial glow — centered on hero */}
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
