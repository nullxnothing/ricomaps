'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { TopBar } from '@/components/app/TopBar';
import { AtlasHudRail } from '@/components/app/AtlasHudRail';
import { AtlasMostWanted } from '@/components/app/AtlasMostWanted';
import { AtlasTicker, type TickerEntry } from '@/components/AtlasTicker';
import { AtlasDossier } from '@/components/AtlasDossier';
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
  const [leftRailOpen, setLeftRailOpen] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(false);
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

  const showDossier = !!(selectedCabal || selectedToken);

  return (
    <div className="app-shell">
      <TopBar active="atlas" />

      <div className="app-body">
        {/* Left HUD rail (overlay on mobile) */}
        {leftRailOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setLeftRailOpen(false)} />}
        <AtlasHudRail
          stats={graph?.stats ?? null}
          live={connected}
          streamSupported={!unsupported}
          className={`${leftRailOpen ? 'rail--overlay flex' : 'hidden'} lg:flex`}
        />

        {/* Center stage — crew graph on the technical grid */}
        <main className="app-stage">
          <AtlasMap
            ref={mapRef}
            graph={graph}
            selectedCabalId={selectedCabal?.id ?? null}
            onSelectCabal={setSelectedCabal}
            onSelectToken={setSelectedToken}
          />

          {/* Mobile rail toggles */}
          <button className="absolute top-3 left-3 z-10 lg:hidden glass-legend !p-2" onClick={() => setLeftRailOpen(true)} aria-label="Atlas status">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
          </button>
          <button className="absolute top-3 right-3 z-10 lg:hidden glass-legend !p-2" onClick={() => setRightRailOpen(true)} aria-label="Most wanted">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </button>

          {/* Live ticker (bottom-left) + hint (bottom-right) */}
          <div className="absolute bottom-3 left-3 z-10 hidden sm:block">
            <AtlasTicker entries={ticker} />
          </div>
          <span className="absolute bottom-3 right-3 z-10 font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-faint pointer-events-none select-none hidden md:block">
            scroll to zoom · drag to pan
          </span>

          <AtlasHint show={!isEmpty && !!graph} />

          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="glass-panel p-6 text-center max-w-[340px] pointer-events-auto" style={{ animation: 'slideUp 0.3s ease-out' }}>
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-text-tertiary mb-2">No intel yet</div>
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

        {/* Right rail — dossier when selected, else Most-Wanted (overlay on mobile) */}
        {rightRailOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setRightRailOpen(false)} />}
        {showDossier ? (
          <div className={`rail rail--right ${rightRailOpen ? 'rail--overlay flex' : 'hidden'} lg:flex`} style={{ width: 286, padding: 16 }}>
            <div className="w-full [&>div]:!w-full">
              <AtlasDossier cabal={selectedCabal} token={selectedToken} graph={graph} onClose={closeDossier} />
            </div>
          </div>
        ) : (
          <AtlasMostWanted
            cabals={graph?.cabals ?? []}
            selectedId={null}
            onSelect={(c) => { setSelectedCabal(c); setSelectedToken(null); }}
            className={`${rightRailOpen ? 'rail--overlay flex' : 'hidden'} lg:flex`}
          />
        )}
      </div>
    </div>
  );
}
