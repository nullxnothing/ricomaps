'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { GraphNode } from '@/lib/types';
import { AddressInput } from '@/components/AddressInput';
import { StatsPanel } from '@/components/StatsPanel';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { TrendingTokens } from '@/components/TrendingTokens';
import { NodeDetailPanel } from '@/components/NodeDetailPanel';
import { useGraphData } from '@/hooks/useGraphData';
import { isValidSolanaAddress, truncateAddress } from '@/lib/address-utils';

const BubbleMap = dynamic(
  () => import('@/components/BubbleMap').then((mod) => mod.BubbleMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center" style={{ background: '#000' }}>
        <div className="spinner-lg" />
      </div>
    ),
  }
);

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: '#000' }} />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [clipboardAddress, setClipboardAddress] = useState<string | null>(null);
  const [autoScanned, setAutoScanned] = useState(false);
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
    if (addressParam && isValidSolanaAddress(addressParam) && !autoScanned && !data) {
      setAutoScanned(true);
      scanWithAutoDetect(addressParam);
    }
  }, [searchParams, autoScanned, data, scanWithAutoDetect]);

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
  }, []);

  const handleBack = useCallback(() => {
    reset();
    setSelectedNode(null);
  }, [reset]);

  // Graph View
  if (data) {
    return (
      <main className="relative w-screen h-screen overflow-hidden" style={{ background: '#000' }}>
        <LoadingOverlay isLoading={isLoading} mode={detectedMode || 'wallet'} />

        {/* Header */}
        <header className="absolute top-0 left-0 right-0 z-10" style={{ background: 'rgba(0,0,0,0.8)', WebkitBackdropFilter: 'blur(16px)', backdropFilter: 'blur(16px)', borderBottom: '1px solid #1a1a1a' }}>
          <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2">
            <button onClick={handleBack} className="btn-back flex-shrink-0" title="Back">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>

            {detectedMode === 'token' && tokenMetadata ? (
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 overflow-hidden">
                {tokenMetadata.image && (
                  <img
                    src={tokenMetadata.image.startsWith('https://') ? tokenMetadata.image : ''}
                    alt=""
                    className="w-5 h-5 rounded-full flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <span className="text-xs sm:text-sm font-semibold truncate max-w-[80px] sm:max-w-[150px] md:max-w-none" style={{ color: '#f0f0f0' }}>
                  {tokenMetadata.name || 'Unknown'}
                </span>
                {tokenMetadata.symbol && (
                  <span className="text-xs flex-shrink-0 hidden sm:inline" style={{ color: '#555' }}>${tokenMetadata.symbol}</span>
                )}
              </div>
            ) : (
              <span className="text-sm font-semibold hidden sm:inline" style={{ color: '#555' }}>RicoMaps</span>
            )}

            {/* Linked wallets headline — hidden on mobile */}
            {detectedMode === 'token' && data && (() => {
              const groups = new Map<string, number>();
              const holders = data.nodes.filter(n => n.type !== 'token');
              const total = holders.reduce((s, n) => s + (n.tokenAmount || 0), 0);
              if (total <= 0) return null;
              for (const n of data.nodes) {
                const g = n.metadata?.sharedFunderGroup;
                if (!g) continue;
                groups.set(g, (groups.get(g) || 0) + ((n.tokenAmount || 0) / total) * 100);
              }
              if (groups.size === 0) return null;
              const pct = Array.from(groups.values()).reduce((s, v) => s + v, 0);
              return (
                <span className="text-xs hidden md:inline" style={{ color: '#555' }}>
                  <span style={{ color: '#ef4444' }}>{groups.size}</span>
                  {' linked wallets hold '}
                  <span className="font-mono" style={{ color: '#b8b8b8' }}>{pct.toFixed(1)}%</span>
                </span>
              );
            })()}

            <div className="ml-auto flex-shrink-0 w-36 sm:w-48 md:w-56">
              <AddressInput onSubmit={handleScan} isLoading={isLoading} isDetecting={isDetecting} />
            </div>
          </div>
        </header>

        {error && (
          <div className="absolute top-14 sm:top-16 left-2 right-2 sm:left-4 sm:right-4 z-10">
            <div className="glass-panel-danger p-3">
              <p className="text-sm" style={{ color: 'var(--red-primary)' }}>{error}</p>
            </div>
          </div>
        )}

        {/* Bubble Map — use absolute instead of fixed to avoid Safari issues */}
        <div className="absolute inset-0 z-0">
          <BubbleMap data={data} onNodeClick={handleNodeClick} />
        </div>

        {/* Stats — responsive positioning */}
        <div className="absolute top-14 sm:top-[60px] right-2 sm:right-3 z-10">
          <StatsPanel
            data={data}
            mode={detectedMode || 'wallet'}
            stats={stats || undefined}
            tokenSecurity={tokenSecurity}
          />
        </div>

        {/* Detail Panel — full-width bottom on mobile */}
        {selectedNode && (
          <div className="absolute bottom-0 left-0 right-0 sm:bottom-4 sm:left-4 sm:right-auto z-10">
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

  // Landing Page
  return (
    <main className="min-h-screen" style={{ background: '#000' }}>
      <LoadingOverlay isLoading={isLoading || isDetecting} mode={detectedMode || 'wallet'} />

      <div className="flex flex-col items-center pt-16 sm:pt-24 pb-8 px-3 sm:px-4 text-center">
        <div className="flex items-center gap-3 mb-4 sm:mb-6">
          <img src="/favicon.png" alt="RicoMaps" className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl" style={{ border: '1px solid var(--border-base)' }} />
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>RicoMaps</h1>
        </div>

        <p className="text-sm sm:text-base mb-6 sm:mb-8 max-w-md px-2" style={{ color: 'var(--text-tertiary)' }}>
          Trace wallet funding chains and expose hidden connections
        </p>

        <div className="w-full max-w-xl mb-4 px-1">
          <AddressInput onSubmit={handleScan} isLoading={isLoading} isDetecting={isDetecting} size="large" />
        </div>

        {clipboardAddress && !isLoading && !isDetecting && (
          <button className="btn-ghost text-xs sm:text-sm mt-2" onClick={() => handleScan(clipboardAddress)}>
            Scan {truncateAddress(clipboardAddress, 4)} from clipboard
          </button>
        )}

        {error && (
          <div className="glass-panel-danger p-3 mt-4 max-w-md w-full">
            <p className="text-sm" style={{ color: 'var(--red-primary)' }}>{error}</p>
          </div>
        )}
      </div>

      <TrendingTokens onTokenClick={handleTokenClick} />

      <div className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 flex gap-1.5 sm:gap-2 z-50">
        <Link href="/blacklist" className="btn-ghost text-xs flex items-center gap-1.5" style={{ color: 'var(--purple-primary)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.75-2.96l-6.93-12a2 2 0 00-3.5 0l-6.93 12A2 2 0 005.07 19z" />
          </svg>
          <span className="hidden sm:inline">Blacklist</span>
        </Link>
        <a href="https://x.com/Nullxnothing" target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          <span className="hidden sm:inline">X</span>
        </a>
      </div>
    </main>
  );
}
