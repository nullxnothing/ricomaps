'use client';

import { useEffect, useRef, useState } from 'react';
import type { HolderDelta } from '@/lib/types';

/**
 * Subscribes to the LaserStream worker's live holder-delta SSE stream for one mint.
 * Mirrors `useVenumPriceStream`: the connection is keyed on [mint, enabled], events
 * (`ready` / `holder` / `heartbeat` / `error`) drive state, and the EventSource
 * auto-reconnects on drop. `onDelta` is held in a ref so re-renders don't re-subscribe.
 *
 * Requires `NEXT_PUBLIC_HOLDER_STREAM_URL` (the worker base URL). When unset or when
 * the connection never opens, `connected` stays false and the caller falls back to polling.
 */

const WORKER_URL = process.env.NEXT_PUBLIC_HOLDER_STREAM_URL;

interface UseHolderStreamReturn {
  connected: boolean;
  error: string | null;
  lastUpdate: number | null;
  eventCount: number;
  /** True when the worker URL isn't configured: caller should use the poll fallback. */
  unsupported: boolean;
}

export function useHolderStream(
  mint: string | null,
  enabled: boolean,
  onDelta: (delta: HolderDelta) => void,
): UseHolderStreamReturn {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [eventCount, setEventCount] = useState(0);

  const onDeltaRef = useRef(onDelta);
  useEffect(() => {
    onDeltaRef.current = onDelta;
  }, [onDelta]);

  const unsupported = !WORKER_URL;

  useEffect(() => {
    if (!enabled || !mint || !WORKER_URL) return;

    const url = `${WORKER_URL.replace(/\/$/, '')}/stream/holders?mint=${encodeURIComponent(mint)}`;
    const es = new EventSource(url);

    es.addEventListener('ready', () => {
      setConnected(true);
      setError(null);
    });

    es.addEventListener('holder', (event) => {
      try {
        const delta = JSON.parse((event as MessageEvent).data) as HolderDelta;
        if (!delta?.owner) return;
        setConnected(true);
        setLastUpdate(Date.now());
        setEventCount((c) => c + 1);
        onDeltaRef.current(delta);
      } catch {
        // Ignore malformed frames; the stream stays open.
      }
    });

    // `heartbeat` just keeps the connection warm, no handler needed.

    es.addEventListener('error', (event) => {
      // Application-level error frame from the worker (e.g. reconnecting upstream).
      try {
        const data = JSON.parse((event as MessageEvent).data) as { message?: string };
        if (data?.message) setError(data.message);
      } catch {
        // Native EventSource error (no data), handled by onerror below.
      }
    });

    es.onerror = () => {
      // Transport dropped; EventSource auto-reconnects. Surface a soft error.
      setConnected(false);
      setError('Holder stream disconnected, retrying…');
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [mint, enabled]);

  return { connected, error, lastUpdate, eventCount, unsupported };
}
