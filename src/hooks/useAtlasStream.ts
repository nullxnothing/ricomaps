'use client';

import { useEffect, useRef, useState } from 'react';
import type { AtlasSpawnEvent, AtlasGraduationEvent, AtlasCabalActivityEvent, AtlasRugEvent, AtlasCabalBuyEvent } from '@/lib/types';

/**
 * Subscribes to the worker's global atlas SSE feed (`/stream/atlas`): pump.fun
 * creates, graduations, cabal fingerprint hits, and rug events. Mirrors
 * `useHolderStream`: handlers live in a ref so re-renders don't re-subscribe,
 * and EventSource auto-reconnects on drop.
 */

const WORKER_URL = process.env.NEXT_PUBLIC_HOLDER_STREAM_URL;

export interface AtlasStreamHandlers {
  onSpawn?: (e: AtlasSpawnEvent) => void;
  onGraduation?: (e: AtlasGraduationEvent) => void;
  onCabalActivity?: (e: AtlasCabalActivityEvent) => void;
  onRug?: (e: AtlasRugEvent) => void;
  onBuy?: (e: AtlasCabalBuyEvent) => void;
}

interface UseAtlasStreamReturn {
  connected: boolean;
  eventCount: number;
  /** True when no worker URL is configured — the page runs in snapshot mode. */
  unsupported: boolean;
}

export function useAtlasStream(enabled: boolean, handlers: AtlasStreamHandlers): UseAtlasStreamReturn {
  const [connected, setConnected] = useState(false);
  const [eventCount, setEventCount] = useState(0);

  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const unsupported = !WORKER_URL;

  useEffect(() => {
    if (!enabled || !WORKER_URL) return;

    const es = new EventSource(`${WORKER_URL.replace(/\/$/, '')}/stream/atlas`);

    const handle = <T,>(event: string, fn: (handlers: AtlasStreamHandlers, data: T) => void) => {
      es.addEventListener(event, (msg) => {
        try {
          fn(handlersRef.current, JSON.parse((msg as MessageEvent).data) as T);
          setEventCount((c) => c + 1);
        } catch {
          // Malformed frame — skip rather than kill the stream.
        }
      });
    };

    es.addEventListener('ready', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource retries automatically

    handle<AtlasSpawnEvent>('token-spawn', (h, d) => h.onSpawn?.(d));
    handle<AtlasGraduationEvent>('graduation', (h, d) => h.onGraduation?.(d));
    handle<AtlasCabalActivityEvent>('cabal-activity', (h, d) => h.onCabalActivity?.(d));
    handle<AtlasRugEvent>('rug-event', (h, d) => h.onRug?.(d));
    handle<AtlasCabalBuyEvent>('cabal-buy', (h, d) => h.onBuy?.(d));

    return () => {
      es.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected, eventCount, unsupported };
}
