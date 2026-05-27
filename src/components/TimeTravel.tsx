'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { HistoricalSnapshot } from '@/lib/snapshot-to-graph';

interface TimeTravelProps {
  mint: string;
  onSnapshotChange: (snapshot: HistoricalSnapshot | null) => void;
  onScrubStats?: (stats: ScrubStats | null) => void;
  isVisible: boolean;
  onClose: () => void;
}

export interface ScrubStats {
  blockTime: number;
  totalHolders: number;
  topHolderPct: number;
  top10Pct: number;
}

interface SnapshotSummary {
  slot: number;
  blockTime: number;
  totalHolders: number;
  topHolderPct: number;
  top10Pct: number;
}

interface TimelineData {
  isComplete: boolean;
  progress: number;
  snapshots: SnapshotSummary[];
  createdAt?: number;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Pure SVG sparkline with hover tooltip
function DistributionSparkline({
  snapshots,
  selectedTime,
}: {
  snapshots: SnapshotSummary[];
  selectedTime: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    x: number;
    top10: number;
    topHolder: number;
    time: number;
  } | null>(null);

  if (snapshots.length < 2) return null;

  const W = 600;
  const H = 60;
  const padX = 0;
  const padY = 2;

  const times = snapshots.map((s) => s.blockTime);
  const minT = times[0];
  const maxT = times[times.length - 1];
  const rangeT = maxT - minT || 1;

  const toX = (t: number) => padX + ((t - minT) / rangeT) * (W - 2 * padX);
  const toY = (pct: number) => padY + ((100 - pct) / 100) * (H - 2 * padY);

  const top10Path = snapshots
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${toX(s.blockTime).toFixed(1)},${toY(s.top10Pct).toFixed(1)}`)
    .join(' ');

  const topHolderPath = snapshots
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${toX(s.blockTime).toFixed(1)},${toY(s.topHolderPct).toFixed(1)}`)
    .join(' ');

  // Area fill under top10 line
  const top10Area =
    top10Path +
    ` L${toX(snapshots[snapshots.length - 1].blockTime).toFixed(1)},${H} L${toX(snapshots[0].blockTime).toFixed(1)},${H} Z`;

  const selectedX = selectedTime ? toX(selectedTime) : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const t = minT + ((relX - padX) / (W - 2 * padX)) * rangeT;

    let closest = snapshots[0];
    let closestDist = Infinity;
    for (const s of snapshots) {
      const d = Math.abs(s.blockTime - t);
      if (d < closestDist) {
        closestDist = d;
        closest = s;
      }
    }
    setHover({
      x: toX(closest.blockTime),
      top10: closest.top10Pct,
      topHolder: closest.topHolderPct,
      time: closest.blockTime,
    });
  };

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: `${H}px` }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-full"
        style={{ display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Grid lines */}
        {[25, 50, 75].map((pct) => (
          <line
            key={pct}
            x1={0}
            y1={toY(pct)}
            x2={W}
            y2={toY(pct)}
            stroke="var(--border-base)"
            strokeWidth="0.5"
          />
        ))}

        {/* Top 10 area fill */}
        <path d={top10Area} fill="var(--blue-ghost)" />

        {/* Top 10 line (blue) */}
        <path d={top10Path} fill="none" stroke="var(--blue-primary)" strokeWidth="1.5" />

        {/* Top holder line (red) */}
        <path d={topHolderPath} fill="none" stroke="var(--red-primary)" strokeWidth="1.5" />

        {/* Selected time indicator */}
        {selectedX !== null && (
          <line x1={selectedX} y1={0} x2={selectedX} y2={H} stroke="var(--green-primary)" strokeWidth="1" strokeDasharray="3,2" />
        )}

        {/* Hover indicator */}
        {hover && (
          <>
            <line x1={hover.x} y1={0} x2={hover.x} y2={H} stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
            <circle cx={hover.x} cy={toY(hover.top10)} r="2.5" fill="var(--blue-primary)" />
            <circle cx={hover.x} cy={toY(hover.topHolder)} r="2.5" fill="var(--red-primary)" />
          </>
        )}
      </svg>

      {/* Hover tooltip */}
      {hover && (
        <div
          className="absolute top-[-36px] pointer-events-none text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{
            left: `${(hover.x / W) * 100}%`,
            transform: 'translateX(-50%)',
            background: 'var(--glass-bg)',
            border: '1px solid var(--border-base)',
            color: 'var(--text-tertiary)',
          }}
        >
          <span style={{ color: 'var(--blue-primary)' }}>T10: {hover.top10.toFixed(1)}%</span>
          {' | '}
          <span style={{ color: 'var(--red-primary)' }}>#{'\u200B'}1: {hover.topHolder.toFixed(1)}%</span>
          {' | '}
          {formatDate(hover.time)}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-[-16px] right-0 flex gap-3 text-[9px]" style={{ color: 'var(--text-tertiary)' }}>
        <span>
          <span className="inline-block w-2 h-0.5 mr-0.5" style={{ background: 'var(--blue-primary)' }} /> Top 10
        </span>
        <span>
          <span className="inline-block w-2 h-0.5 mr-0.5" style={{ background: 'var(--red-primary)' }} /> #1 Holder
        </span>
      </div>
    </div>
  );
}

export function TimeTravel({ mint, onSnapshotChange, onScrubStats, isVisible, onClose }: TimeTravelProps) {
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [sliderIndex, setSliderIndex] = useState<number | null>(null);
  const [, setIsScrubbing] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [isFetchingSnapshot, setIsFetchingSnapshot] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cache for fetched full snapshots keyed by blockTime
  const snapshotCacheRef = useRef<Map<number, HistoricalSnapshot>>(new Map());

  // Fetch timeline status / check if data exists
  const fetchTimeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/token/history?mint=${mint}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json as TimelineData;
    } catch {
      return null;
    }
  }, [mint]);

  // Trigger backfill
  const startBackfill = useCallback(async () => {
    try {
      await fetch('/api/token/history/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint }),
      });
    } catch {
      // Silently fail -- polling will show progress
    }
  }, [mint]);

  // Init: check status, start backfill if needed, poll
  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;

    async function init() {
      const data = await fetchTimeline();
      if (cancelled) return;

      if (!data) {
        // No data at all -- trigger backfill
        await startBackfill();
        setIsPolling(true);
        return;
      }

      setTimeline(data);

      if (!data.isComplete) {
        if (data.progress === 0) {
          await startBackfill();
        }
        setIsPolling(true);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [mint, isVisible, fetchTimeline, startBackfill]);

  // Polling loop for backfill progress
  useEffect(() => {
    if (!isPolling || !isVisible) return;

    pollRef.current = setInterval(async () => {
      const data = await fetchTimeline();
      if (!data) return;
      setTimeline(data);
      if (data.isComplete) {
        setIsPolling(false);
      }
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isPolling, isVisible, fetchTimeline]);

  useEffect(() => {
    if (isVisible) return;
    if (pollRef.current) clearInterval(pollRef.current);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsFetchingSnapshot(false);
  }, [isVisible]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Fetch a full snapshot (with holders array) for a given blockTime
  const fetchFullSnapshot = useCallback(async (blockTime: number) => {
    // Check cache first
    const cached = snapshotCacheRef.current.get(blockTime);
    if (cached) {
      onSnapshotChange(cached);
      setIsFetchingSnapshot(false);
      return;
    }

    setIsFetchingSnapshot(true);
    try {
      const res = await fetch(
        `/api/token/history?mint=${mint}&timestamp=${blockTime}`,
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.snapshot) {
        const snap = json.snapshot as HistoricalSnapshot;
        snapshotCacheRef.current.set(blockTime, snap);
        onSnapshotChange(snap);
      }
    } catch {
      // Silently fail
    } finally {
      setIsFetchingSnapshot(false);
    }
  }, [mint, onSnapshotChange]);

  // Real-time scrub: fires on every input event (continuous drag)
  const handleSliderInput = useCallback(
    (index: number) => {
      setSliderIndex(index);
      setIsLive(false);
      setIsScrubbing(true);

      const summary = timeline?.snapshots?.[index];
      if (summary && onScrubStats) {
        onScrubStats({
          blockTime: summary.blockTime,
          totalHolders: summary.totalHolders,
          topHolderPct: summary.topHolderPct,
          top10Pct: summary.top10Pct,
        });
      }

      // Debounce the full snapshot fetch
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setIsScrubbing(false);
        if (summary) {
          fetchFullSnapshot(summary.blockTime);
        }
      }, 400);
    },
    [timeline, onScrubStats, fetchFullSnapshot],
  );

  // Final commit when user releases slider
  const handleSliderChange = useCallback(
    (index: number) => {
      setSliderIndex(index);
      setIsLive(false);
      setIsScrubbing(false);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      const summary = timeline?.snapshots?.[index];
      if (summary) {
        fetchFullSnapshot(summary.blockTime);
      }
    },
    [timeline, fetchFullSnapshot],
  );

  const handleLive = useCallback(() => {
    setIsLive(true);
    setSliderIndex(null);
    setIsScrubbing(false);
    onSnapshotChange(null);
    if (onScrubStats) onScrubStats(null);
  }, [onSnapshotChange, onScrubStats]);

  const snapshots = timeline?.snapshots ?? [];
  const isComplete = timeline?.isComplete ?? false;
  const progress = timeline?.progress ?? 0;

  const launchTime = snapshots.length > 0 ? snapshots[0].blockTime : 0;
  const nowTime = snapshots.length > 0 ? snapshots[snapshots.length - 1].blockTime : 0;

  const currentSliderSnapshot = sliderIndex !== null ? snapshots[sliderIndex] : null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-20 transition-transform duration-300 ease-out"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
        transform: isVisible ? 'translateY(0)' : 'translateY(100%)',
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
    >
      <div className="max-w-3xl mx-auto px-4 py-3">
        {/* Backfill progress */}
        {!isComplete && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Analyzing historical data...{' '}
                <span className="font-mono" style={{ color: 'var(--green-primary)' }}>
                  {Math.round(progress)}%
                </span>
              </span>
              <div className="animate-pulse w-1.5 h-1.5 rounded-full" style={{ background: 'var(--green-primary)' }} />
            </div>
            <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--border-base)' }}>
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${Math.min(100, Math.round(progress))}%`,
                  background: 'linear-gradient(90deg, var(--green-primary), var(--green-dim))',
                }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 p-1 rounded transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          aria-label="Close time travel"
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Sparkline */}
        {isComplete && snapshots.length >= 2 && (
          <div className="mb-4 pt-1">
            <DistributionSparkline
              snapshots={snapshots}
              selectedTime={currentSliderSnapshot?.blockTime ?? null}
            />
          </div>
        )}

        {/* Slider + controls */}
        {isComplete && snapshots.length > 0 && (
          <>
            {/* Current selection label */}
            <div className="text-center mb-1.5">
              {isLive ? (
                <span className="text-xs font-medium" style={{ color: 'var(--green-primary)' }}>
                  Live
                </span>
              ) : currentSliderSnapshot ? (
                <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                  {formatDateTime(currentSliderSnapshot.blockTime)}
                </span>
              ) : (
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Select a point in time
                </span>
              )}
            </div>

            {/* Slider */}
            <div className="relative mb-1">
              <input
                type="range"
                min={0}
                max={snapshots.length - 1}
                step={1}
                value={sliderIndex ?? snapshots.length - 1}
                onInput={(e) => handleSliderInput(parseInt((e.target as HTMLInputElement).value, 10))}
                onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
                className="time-travel-slider w-full"
                aria-label="Time travel slider"
              />
            </div>

            {/* Date labels */}
            <div className="flex justify-between text-[10px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
              <span>Launch {launchTime > 0 && `(${formatDate(launchTime)})`}</span>
              <span>Now {nowTime > 0 && `(${formatDate(nowTime)})`}</span>
            </div>

            {/* Stats bar + Live button */}
            <div className="flex items-center gap-2">
              {/* Stats bar */}
              {!isLive && currentSliderSnapshot && (
                <div
                  className="flex-1 flex items-center gap-3 px-3 py-1.5 rounded-lg text-[11px] font-mono overflow-x-auto"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-base)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {isFetchingSnapshot && (
                      <span className="inline-block w-2.5 h-2.5 border border-[var(--green-primary)] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    )}
                    <span style={{ color: 'var(--text-tertiary)' }}>Snapshot:</span>{' '}
                    <span style={{ color: 'var(--text-primary)' }}>{formatDateTime(currentSliderSnapshot.blockTime)}</span>
                  </span>
                  <span style={{ color: 'var(--border-base)' }}>|</span>
                  <span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Top 10:</span>{' '}
                    <span style={{ color: 'var(--blue-primary)' }}>{currentSliderSnapshot.top10Pct.toFixed(1)}%</span>
                  </span>
                  <span style={{ color: 'var(--border-base)' }}>|</span>
                  <span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Holders:</span>{' '}
                    <span style={{ color: 'var(--text-primary)' }}>{currentSliderSnapshot.totalHolders}</span>
                  </span>
                  <span style={{ color: 'var(--border-base)' }}>|</span>
                  <span>
                    <span style={{ color: 'var(--text-tertiary)' }}>Top:</span>{' '}
                    <span style={{ color: 'var(--red-primary)' }}>{currentSliderSnapshot.topHolderPct.toFixed(1)}%</span>
                  </span>
                </div>
              )}

              {/* Live button */}
              {!isLive && (
                <button
                  onClick={handleLive}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
                  style={{
                    background: 'rgba(0,255,65,0.1)',
                    border: '1px solid rgba(0,255,65,0.3)',
                    color: 'var(--green-primary)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0,255,65,0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0,255,65,0.1)';
                  }}
                >
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--green-primary)' }} />
                  Live
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
