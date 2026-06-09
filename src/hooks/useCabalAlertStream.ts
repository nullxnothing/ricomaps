'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Subscribes to the LaserStream worker's /stream/cabal SSE for a set of watched
 * funder wallets. Clones useHolderStream's transport (EventSource, ready/heartbeat/
 * error, unsupported fallback). Buffers `cabal-alert` frames per funder in a sliding
 * window and fires `onFanout` when one funder sends to N+ recipients inside the window
 * — the pre-launch tell. Single raw frames also drive `onAlert` for a live ticker.
 */

const WORKER_URL = process.env.NEXT_PUBLIC_HOLDER_STREAM_URL;
const FANOUT_MIN_RECIPIENTS = 3;
const FANOUT_WINDOW_MS = 60_000;

export interface CabalAlertFrame {
  watchedFunder: string;
  recipient: string;
  amount: number;
  slot: number;
  signature: string;
  ts: number;
}

export interface FanoutRollup {
  funderWallet: string;
  recipients: string[];
  totalSol: number;
  signature: string;
  slot: number;
}

interface UseCabalAlertStreamReturn {
  connected: boolean;
  error: string | null;
  alertCount: number;
  unsupported: boolean;
}

export function useCabalAlertStream(
  wallets: string[],
  enabled: boolean,
  onAlert: (frame: CabalAlertFrame) => void,
  onFanout: (rollup: FanoutRollup) => void,
): UseCabalAlertStreamReturn {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertCount, setAlertCount] = useState(0);

  const onAlertRef = useRef(onAlert);
  const onFanoutRef = useRef(onFanout);
  useEffect(() => { onAlertRef.current = onAlert; }, [onAlert]);
  useEffect(() => { onFanoutRef.current = onFanout; }, [onFanout]);

  // Sliding window of recent recipients per funder, for fan-out detection.
  const bufferRef = useRef<Map<string, CabalAlertFrame[]>>(new Map());
  const firedRef = useRef<Set<string>>(new Set()); // signatures already rolled up

  const unsupported = !WORKER_URL;
  const walletsKey = wallets.slice().sort().join(',');

  const evaluateFanout = useCallback((funder: string) => {
    const now = Date.now();
    const frames = (bufferRef.current.get(funder) ?? []).filter(f => now - f.ts * 1000 < FANOUT_WINDOW_MS);
    bufferRef.current.set(funder, frames);

    const recipients = [...new Set(frames.map(f => f.recipient).filter(Boolean))];
    if (recipients.length < FANOUT_MIN_RECIPIENTS) return;

    // Use the latest signature as the rollup key; only fire once per burst.
    const latest = frames[frames.length - 1];
    if (firedRef.current.has(latest.signature)) return;
    firedRef.current.add(latest.signature);

    onFanoutRef.current({
      funderWallet: funder,
      recipients,
      totalSol: frames.reduce((sum, f) => sum + f.amount, 0),
      signature: latest.signature,
      slot: latest.slot,
    });
  }, []);

  useEffect(() => {
    if (!enabled || wallets.length === 0 || !WORKER_URL) return;

    const url = `${WORKER_URL.replace(/\/$/, '')}/stream/cabal?wallets=${encodeURIComponent(walletsKey)}`;
    const es = new EventSource(url);
    bufferRef.current.clear();
    firedRef.current.clear();

    es.addEventListener('ready', () => { setConnected(true); setError(null); });

    es.addEventListener('cabal-alert', (event) => {
      try {
        const frame = JSON.parse((event as MessageEvent).data) as CabalAlertFrame;
        if (!frame?.watchedFunder) return;
        setConnected(true);
        setAlertCount(c => c + 1);
        onAlertRef.current(frame);

        const list = bufferRef.current.get(frame.watchedFunder) ?? [];
        list.push(frame);
        bufferRef.current.set(frame.watchedFunder, list);
        evaluateFanout(frame.watchedFunder);
      } catch {
        // Ignore malformed frames.
      }
    });

    es.addEventListener('error', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { message?: string };
        if (data?.message) setError(data.message);
      } catch {
        // Native error handled below.
      }
    });

    es.onerror = () => {
      setConnected(false);
      setError('Alert stream disconnected, retrying…');
    };

    return () => { es.close(); setConnected(false); };
  }, [walletsKey, enabled, wallets.length, evaluateFanout]);

  return { connected, error, alertCount, unsupported };
}
