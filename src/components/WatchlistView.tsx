'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell } from './layout/PageShell';
import { Container } from './layout/Container';
import { useGateContext } from './GateProvider';
import { useCabalAlertStream, type CabalAlertFrame, type FanoutRollup } from '@/hooks/useCabalAlertStream';
import { truncateAddress } from '@/lib/address-utils';
import { timeAgo } from '@/lib/format';

interface WatchlistEntry {
  id: string;
  label: string;
  funderWallets: string[];
  fingerprintId?: string;
  createdAt: number;
}

interface ActivityRow {
  id: string;
  funderWallet: string;
  recipients: string[];
  walletCount: number;
  totalSol: number;
  threatScore: number;
  detectedAt: number;
  signature: string;
}

function threatColor(score: number): string {
  if (score >= 70) return 'var(--red-primary)';
  if (score >= 40) return 'var(--amber-primary)';
  return 'var(--text-tertiary)';
}

export function WatchlistView() {
  const router = useRouter();
  const { unlocked, loading: gateLoading, unlock } = useGateContext();

  const [watchlists, setWatchlists] = useState<WatchlistEntry[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<CabalAlertFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Aggregate every watched funder across all watchlists for one SSE subscription.
  const allWallets = [...new Set(watchlists.flatMap(w => w.funderWallets))];

  const loadWatchlists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/watchlist');
      const json = await res.json();
      if (json.success) setWatchlists(json.watchlists);
      else if (res.status === 403) setError('Hold $RICO and connect your wallet to use watchlists.');
    } catch {
      setError('Failed to load watchlists');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    const rows: ActivityRow[] = [];
    for (const w of watchlists) {
      try {
        const res = await fetch(`/api/watchlist/${w.id}/activity`);
        const json = await res.json();
        if (json.success) rows.push(...json.activity);
      } catch { /* skip */ }
    }
    rows.sort((a, b) => b.detectedAt - a.detectedAt);
    setActivity(rows);
  }, [watchlists]);

  useEffect(() => { if (unlocked) loadWatchlists(); }, [unlocked, loadWatchlists]);
  useEffect(() => { if (watchlists.length) loadActivity(); }, [watchlists, loadActivity]);

  // When a fan-out is detected, POST the roll-up to persist + score, then refresh.
  const handleFanout = useCallback(async (rollup: FanoutRollup) => {
    const target = watchlists.find(w => w.funderWallets.includes(rollup.funderWallet));
    if (!target) return;
    try {
      await fetch(`/api/watchlist/${target.id}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rollup),
      });
      loadActivity();
    } catch { /* best effort */ }
  }, [watchlists, loadActivity]);

  const handleAlert = useCallback((frame: CabalAlertFrame) => {
    setLiveAlerts(prev => [frame, ...prev].slice(0, 20));
  }, []);

  const { connected, unsupported } = useCabalAlertStream(allWallets, unlocked && allWallets.length > 0, handleAlert, handleFanout);

  const deleteWatchlist = useCallback(async (id: string) => {
    await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
    setWatchlists(prev => prev.filter(w => w.id !== id));
  }, []);

  // ── Locked state ──────────────────────────────────────────────────────────
  if (!gateLoading && !unlocked) {
    return (
      <PageShell>
        <Container className="py-20 flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-base)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-xl font-bold">Cabal Radar — holders only</h1>
          <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
            Watch a cabal&apos;s funding wallets in real time. When a watched funder fans fresh SOL into new wallets — the pre-launch tell — you get an alert before they buy.
          </p>
          <button
            onClick={unlock}
            className="px-4 py-2 rounded-md text-sm font-medium"
            style={{ background: 'var(--green-ghost)', color: 'var(--green-primary)', border: '1px solid rgba(0,255,65,0.25)' }}
          >
            Unlock with $RICO
          </button>
        </Container>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Container className="py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-bold">Cabal Radar</h1>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: connected ? 'var(--green-primary)' : 'var(--text-tertiary)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? 'var(--green-primary)' : 'var(--text-tertiary)' }} />
            {unsupported ? 'Stream offline (poll mode)' : connected ? 'Live' : 'Connecting…'}
          </div>
        </div>
        <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
          Watching {allWallets.length} funder {allWallets.length === 1 ? 'wallet' : 'wallets'} across {watchlists.length} {watchlists.length === 1 ? 'crew' : 'crews'}.
        </p>

        {error && <p className="text-xs mb-4" style={{ color: 'var(--red-primary)' }}>{error}</p>}

        <div className="grid md:grid-cols-2 gap-5">
          {/* Watched crews */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-secondary)' }}>Watched crews</h2>
            {loading ? (
              <div className="spinner-lg mx-auto my-8" />
            ) : watchlists.length === 0 ? (
              <p className="text-xs py-6 text-center" style={{ color: 'var(--text-tertiary)' }}>
                No crews watched yet. Scan a token, find a cabal, and click &quot;Watch this crew&quot; in the stats panel.
              </p>
            ) : (
              <div className="space-y-2">
                {watchlists.map(w => (
                  <div key={w.id} className="glass-panel p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{w.label}</span>
                      <button onClick={() => deleteWatchlist(w.id)} className="text-xs" style={{ color: 'var(--text-tertiary)' }} title="Remove">✕</button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {w.funderWallets.map(addr => (
                        <button key={addr} className="wallet-pill" onClick={() => router.push(`/?address=${addr}`)} title={addr}>
                          {truncateAddress(addr, 4)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Alert feed */}
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-secondary)' }}>Alerts</h2>

            {liveAlerts.length > 0 && (
              <div className="mb-3 space-y-1">
                {liveAlerts.slice(0, 5).map((a, i) => (
                  <div key={`${a.signature}-${i}`} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded" style={{ background: 'var(--bg-elevated)' }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--amber-primary)' }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{truncateAddress(a.watchedFunder, 4)}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>→ {truncateAddress(a.recipient, 4)}</span>
                    <span className="ml-auto font-mono" style={{ color: 'var(--amber-primary)' }}>{a.amount.toFixed(3)} SOL</span>
                  </div>
                ))}
              </div>
            )}

            {activity.length === 0 ? (
              <p className="text-xs py-6 text-center" style={{ color: 'var(--text-tertiary)' }}>
                No fan-out alerts yet. You&apos;ll see one when a watched funder seeds 3+ fresh wallets within 60s.
              </p>
            ) : (
              <div className="space-y-2">
                {activity.map(a => (
                  <div key={a.id} className="glass-panel p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: 'var(--red-primary)' }}>Fan-out detected</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{timeAgo(a.detectedAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <button className="wallet-pill" onClick={() => router.push(`/?address=${a.funderWallet}`)} title={a.funderWallet}>
                        {truncateAddress(a.funderWallet, 4)}
                      </button>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        seeded {a.walletCount} fresh {a.walletCount === 1 ? 'wallet' : 'wallets'} · {a.totalSol.toFixed(2)} SOL
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: threatColor(a.threatScore), background: 'var(--bg-elevated)' }}>
                        threat {a.threatScore}
                      </span>
                      {a.signature && (
                        <a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noopener noreferrer" className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          tx ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </Container>
    </PageShell>
  );
}
