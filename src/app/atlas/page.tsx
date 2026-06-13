'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { AtlasHud } from '@/components/AtlasHud';
import { AtlasTicker, type TickerEntry } from '@/components/AtlasTicker';
import { AtlasDossier } from '@/components/AtlasDossier';
import { AtlasLeaderboard } from '@/components/AtlasLeaderboard';
import { AtlasHint } from '@/components/AtlasHint';
import { useAtlasStream } from '@/hooks/useAtlasStream';
import { truncateAddress } from '@/lib/address-utils';
import { formatUsd } from '@/lib/format';
import type { AtlasCabalNode, AtlasGraph, AtlasToken } from '@/lib/types';
import type { AtlasMapHandle } from '@/components/AtlasMap';

const REFRESH_INTERVAL_MS = 60_000;
const TICKER_MAX = 30;
const BUY_TICKER_THROTTLE_SEC = 6; // one ticker row per cabal+token per N seconds

const AtlasMap = dynamic(() => import('@/components/AtlasMap').then((m) => m.AtlasMap), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-bg-void">
      <div className="spinner-lg" />
    </div>
  ),
});

export default function AtlasPage() {
  const [graph, setGraph] = useState<AtlasGraph | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedCabal, setSelectedCabal] = useState<AtlasCabalNode | null>(null);
  const [selectedToken, setSelectedToken] = useState<AtlasToken | null>(null);
  const [ticker, setTicker] = useState<TickerEntry[]>([]);
  const mapRef = useRef<AtlasMapHandle>(null);
  const buyTickerRef = useRef<Map<string, number>>(new Map());

  const pushTicker = useCallback((entry: TickerEntry) => {
    setTicker((prev) => [entry, ...prev].slice(0, TICKER_MAX));
  }, []);

  const { connected, unsupported } = useAtlasStream(true, {
    onSpawn: (e) => {
      mapRef.current?.spawn(e);
      pushTicker({
        id: `${e.signature}-spawn`, kind: 'spawn', ts: e.ts,
        text: e.name ?? (e.symbol ? `$${e.symbol}` : truncateAddress(e.mint)),
        sub: e.symbol && e.name ? `$${e.symbol}` : undefined,
      });
    },
    onGraduation: (e) => {
      mapRef.current?.graduate(e);
      pushTicker({
        id: `${e.signature}-grad`, kind: 'graduation', ts: e.ts,
        text: e.name ?? (e.symbol ? `$${e.symbol}` : truncateAddress(e.mint)),
        sub: 'bonding curve complete, scanning',
      });
    },
    onCabalActivity: (e) => {
      if (e.fingerprintMatches === 0) return; // clean scans are noise; crews are signal
      pushTicker({
        id: `${e.mint}-${e.ts}-cabal`, kind: 'cabal', ts: e.ts,
        text: e.symbol ? `$${e.symbol}` : truncateAddress(e.mint),
        sub: `matched ${e.fingerprintMatches} known crew${e.fingerprintMatches === 1 ? '' : 's'}${e.cabalSupplyPct ? ` · ${e.cabalSupplyPct.toFixed(1)}% held` : ''}`,
      });
    },
    onRug: (e) => {
      mapRef.current?.rug(e);
      pushTicker({
        id: `${e.mint}-${e.ts}-rug`, kind: 'rug', ts: e.ts,
        text: e.symbol ? `$${e.symbol}` : truncateAddress(e.mint),
        sub: e.estExtractedUsd > 0 ? `${formatUsd(e.estExtractedUsd)} extracted` : undefined,
      });
    },
    onBuy: (e) => {
      mapRef.current?.buy(e);
      // Throttle ticker rows per (cabal,token); the beam itself carries every buy.
      const key = `${e.cabalId}:${e.mint}`;
      const last = buyTickerRef.current.get(key) ?? 0;
      if (e.ts - last < BUY_TICKER_THROTTLE_SEC) return;
      buyTickerRef.current.set(key, e.ts);
      pushTicker({
        id: `${key}-${e.ts}-buy`, kind: 'buy', ts: e.ts,
        text: e.symbol ? `$${e.symbol}` : truncateAddress(e.mint),
        sub: `C-${e.cabalId.slice(0, 4).toUpperCase()} buying`,
      });
    },
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/atlas');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled && data.success) {
          setGraph(data as AtlasGraph);
          setLoadError(false);
        }
      } catch {
        if (!cancelled && !graph) setLoadError(true);
      }
    };
    void load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dev-only: expose the map's live-event handle so beams can be exercised without
  // the deployed worker. Tree-shaken out of production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __atlasMapRef?: typeof mapRef }).__atlasMapRef = mapRef;
  }, []);

  const closeDossier = useCallback(() => {
    setSelectedCabal(null);
    setSelectedToken(null);
  }, []);

  const isEmpty = graph !== null && graph.cabals.length === 0 && graph.tokens.length === 0;

  return (
    <div className="h-screen flex flex-col bg-bg-void overflow-hidden">
      <Navbar />
      <main className="relative flex-1 min-h-0">
        <AtlasMap
          ref={mapRef}
          graph={graph}
          selectedCabalId={selectedCabal?.id ?? null}
          onSelectCabal={setSelectedCabal}
          onSelectToken={setSelectedToken}
        />

        {/* Overlay chrome: panels re-enable pointer events individually */}
        <div className="absolute inset-0 pointer-events-none p-4 flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <AtlasHud stats={graph?.stats ?? null} live={connected} streamSupported={!unsupported} />
            {/* Right rail: dossier when something's selected, else the Most-Wanted index. */}
            <div className="max-h-full overflow-hidden flex">
              {selectedCabal || selectedToken ? (
                <AtlasDossier cabal={selectedCabal} token={selectedToken} graph={graph} onClose={closeDossier} />
              ) : (
                <AtlasLeaderboard
                  cabals={graph?.cabals ?? []}
                  selectedId={null}
                  onSelect={(c) => { setSelectedCabal(c); setSelectedToken(null); }}
                />
              )}
            </div>
          </div>
          <div className="mt-auto flex items-end justify-between gap-4">
            <AtlasTicker entries={ticker} />
            <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary pointer-events-none pb-1">
              scroll to zoom · drag to pan
            </span>
          </div>
        </div>

        <AtlasHint show={!isEmpty && !!graph} />

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="glass-panel p-6 text-center max-w-[340px] pointer-events-auto" style={{ animation: 'slideUp 0.3s ease-out' }}>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-text-tertiary mb-2">
                No intel yet
              </div>
              <p className="text-[13px] text-text-secondary leading-relaxed mb-4">
                The atlas builds itself from scans. Run a few token scans, and every crew it finds gets fingerprinted and tracked here.
              </p>
              <Link href="/" className="btn-cta">Scan a token</Link>
            </div>
          </div>
        )}

        {loadError && !graph && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="glass-panel-danger p-5 text-center pointer-events-auto">
              <p className="text-[13px] text-red-primary">Failed to load the atlas. Retrying shortly…</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
