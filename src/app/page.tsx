'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { GraphNode } from '@/lib/types';
import { AddressInput } from '@/components/AddressInput';
import { StatsPanel } from '@/components/StatsPanel';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { TrendingTokens } from '@/components/TrendingTokens';
import { StreamControl } from '@/components/StreamControl';
import { NodeDetailPanel } from '@/components/NodeDetailPanel';
import { TransactionFeed } from '@/components/TransactionFeed';
import { useGraphData } from '@/hooks/useGraphData';
import { isValidSolanaAddress, truncateAddress } from '@/lib/address-utils';

// Dynamic import to avoid SSR issues with Three.js
// ForensicGraph3D - Clean cyberpunk visualization with distinct node shapes
const ForensicGraph3D = dynamic(
  () => import('@/components/ForensicGraph3D').then((mod) => mod.ForensicGraph3D),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[#4a9eff] font-mono text-sm">INITIALIZING FORENSIC VIEW...</div>
      </div>
    ),
  }
);

// Legacy Graph3D - Bubble style (keep for fallback)
const Graph3D = dynamic(
  () => import('@/components/Graph3D').then((mod) => mod.Graph3D),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[#e34946] animate-pulse">Loading 3D visualization...</div>
      </div>
    ),
  }
);

export default function Home() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [clipboardAddress, setClipboardAddress] = useState<string | null>(null);
  const [useForensicView, setUseForensicView] = useState(true); // Default to new forensic view
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
    streaming,
    startStreaming,
    stopStreaming,
  } = useGraphData();

  // Check clipboard for valid Solana address on mount
  useEffect(() => {
    async function checkClipboard() {
      try {
        // Only check if clipboard API is available and we have permission
        if (!navigator.clipboard?.readText) return;

        const text = await navigator.clipboard.readText();
        const trimmed = text?.trim();

        if (trimmed && isValidSolanaAddress(trimmed)) {
          setClipboardAddress(trimmed);
        }
      } catch {
        // Clipboard access denied or not available - silently ignore
      }
    }

    checkClipboard();
  }, []);

  const handleScan = useCallback(async (address: string) => {
    reset();
    setSelectedNode(null);
    setClipboardAddress(null);
    await scanWithAutoDetect(address);
  }, [scanWithAutoDetect, reset]);

  const handleTokenClick = useCallback(async (address: string) => {
    reset();
    setSelectedNode(null);
    await scanWithAutoDetect(address);
  }, [scanWithAutoDetect, reset]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    // Don't auto-expand - let user click the buttons to expand
  }, []);

  const handleBack = useCallback(() => {
    stopStreaming();
    reset();
    setSelectedNode(null);
  }, [reset, stopStreaming]);

  const handleStreamToggle = useCallback(() => {
    if (streaming.isStreaming) {
      stopStreaming();
    } else {
      startStreaming();
    }
  }, [streaming.isStreaming, startStreaming, stopStreaming]);

  // Graph View (has data)
  if (data) {
    return (
      <main className="relative w-screen h-screen overflow-hidden">
        {/* Loading Overlay */}
        <LoadingOverlay isLoading={isLoading} mode={detectedMode || 'wallet'} />

        {/* Compact Header */}
        <header className="absolute top-0 left-0 right-0 z-10 p-4">
          <div className="flex items-center gap-4">
            {/* Back Button */}
            <button
              onClick={handleBack}
              className="btn-back"
              title="Back to home"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>

            {/* Logo */}
            <div className="flex items-center gap-2">
              <img src="/favicon.png" alt="RicoMaps" className="w-8 h-8 rounded-lg" />
              <h1 className="text-lg font-bold text-[#e34946]">RicoMaps</h1>
            </div>

            {/* Token Info or Mode Badge */}
            {detectedMode === 'token' && tokenMetadata ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a2e]/80 rounded-lg border border-[#2a2a4a]">
                {tokenMetadata.image && (
                  <img
                    src={tokenMetadata.image}
                    alt={tokenMetadata.name || 'Token'}
                    className="w-6 h-6 rounded-full"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-white leading-tight">
                    {tokenMetadata.name || 'Unknown Token'}
                  </span>
                  {tokenMetadata.symbol && (
                    <span className="text-[10px] text-[#6b7280] leading-tight">${tokenMetadata.symbol}</span>
                  )}
                </div>
              </div>
            ) : detectedMode && (
              <span className="mode-badge">
                {detectedMode === 'token' ? 'Token Analysis' : 'Wallet Trace'}
              </span>
            )}

            {/* Stream Control */}
            <StreamControl
              isStreaming={streaming.isStreaming}
              isConnecting={streaming.isConnecting}
              watchedCount={streaming.watchedAddresses.length}
              transactionCount={streaming.transactionCount}
              error={streaming.error}
              onToggle={handleStreamToggle}
            />

            {/* Compact Search */}
            <div className="flex-1 max-w-md ml-auto">
              <AddressInput
                onSubmit={handleScan}
                isLoading={isLoading}
                isDetecting={isDetecting}
              />
            </div>
          </div>
        </header>

        {/* Error Message */}
        {error && (
          <div className="absolute top-20 left-4 right-4 z-10">
            <div className="card bg-[#ff336620] border-[#ff3366]">
              <p className="text-[#ff3366] text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* 3D Graph - Toggle between Forensic and Legacy views */}
        <div className="fixed inset-0 z-0">
          {useForensicView ? (
            <ForensicGraph3D
              data={data}
              onNodeClick={handleNodeClick}
            />
          ) : (
            <Graph3D
              data={data}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        {/* View Toggle */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-1 bg-[#0a0a0a]/90 border border-[#1f2937] rounded-lg p-1">
            <button
              onClick={() => setUseForensicView(true)}
              className={`px-3 py-1.5 text-[10px] font-mono font-medium rounded transition-all ${
                useForensicView
                  ? 'bg-[#4a9eff] text-black'
                  : 'text-[#6b7280] hover:text-[#4a9eff]'
              }`}
            >
              FORENSIC
            </button>
            <button
              onClick={() => setUseForensicView(false)}
              className={`px-3 py-1.5 text-[10px] font-mono font-medium rounded transition-all ${
                !useForensicView
                  ? 'bg-[#e34946] text-black'
                  : 'text-[#6b7280] hover:text-[#e34946]'
              }`}
            >
              BUBBLE
            </button>
          </div>
        </div>

        {/* Stats Panel */}
        <div className="absolute top-20 right-4 z-10">
          <StatsPanel
            data={data}
            mode={detectedMode || 'wallet'}
            stats={stats || undefined}
            tokenSecurity={tokenSecurity}
            streaming={{
              isStreaming: streaming.isStreaming,
              transactionCount: streaming.transactionCount,
            }}
          />
        </div>

        {/* Transaction Feed - shows when streaming */}
        {streaming.isStreaming && (
          <div className="absolute top-20 left-4 z-10">
            <TransactionFeed
              transactions={streaming.transactions}
              maxItems={8}
              onAddressClick={(address) => {
                const node = data?.nodes.find(n => n.id === address);
                if (node) {
                  setSelectedNode(node);
                }
              }}
            />
          </div>
        )}

        {/* Selected Node Detail Panel */}
        {selectedNode && (
          <div className="absolute bottom-4 left-4 z-10">
            <NodeDetailPanel
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              onExpandFunding={!selectedNode.expanded && selectedNode.type !== 'token' ? () => expandNode(selectedNode.id, 'funding') : undefined}
              onExpandFunded={selectedNode.type !== 'token' ? () => expandNode(selectedNode.id, 'funded') : undefined}
              isLoading={isLoading}
            />
          </div>
        )}


      </main>
    );
  }

  // Landing Page View (no data)
  return (
    <main className="landing-page">
      {/* Loading Overlay */}
      <LoadingOverlay isLoading={isLoading || isDetecting} mode={detectedMode || 'wallet'} />

      {/* Hero Section */}
      <div className="landing-hero">
        {/* Logo and Title */}
        <div className="hero-brand">
          <img src="/favicon.png" alt="RicoMaps" className="hero-logo" />
          <h1 className="hero-title">RicoMaps</h1>
        </div>

        {/* Tagline */}
        <p className="hero-tagline">
          Trace wallet funding chains and expose hidden connections in real time
        </p>

        {/* Large Search Bar */}
        <div className="hero-search">
          <AddressInput
            onSubmit={handleScan}
            isLoading={isLoading}
            isDetecting={isDetecting}
            size="large"
          />
        </div>

        {/* Clipboard Detection */}
        {clipboardAddress && !isLoading && !isDetecting && (
          <button
            className="clipboard-btn"
            onClick={() => handleScan(clipboardAddress)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
            </svg>
            <span>Scan {truncateAddress(clipboardAddress, 4)} from clipboard</span>
          </button>
        )}

        {/* Error Message */}
        {error && (
          <div className="hero-error">
            <p>{error}</p>
          </div>
        )}
      </div>

      {/* Trending Tokens Section */}
      <TrendingTokens onTokenClick={handleTokenClick} />

      {/* Social Links */}
      <div className="social-links">
        <a
          href="https://pump.fun/coin/GmfCguoum2Mbw6ohrFtjuPo5hjsjoWv36YYzwxdwpump"
          target="_blank"
          rel="noopener noreferrer"
          className="social-link-btn token-btn"
          title="$RicoMaps Token - GmfCguoum2Mbw6ohrFtjuPo5hjsjoWv36YYzwxdwpump"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v12M6 12h12" />
          </svg>
          <span>$RicoMaps</span>
        </a>
        <a
          href="/docs"
          className="social-link-btn"
          title="Documentation"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <span>Docs</span>
        </a>
        <a
          href="https://x.com/RicoMaps"
          target="_blank"
          rel="noopener noreferrer"
          className="social-link-btn"
          title="Follow us on X"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          <span>X</span>
        </a>
      </div>
    </main>
  );
}
