'use client';

import { useEffect, useRef, useState } from 'react';
import type { VenumPrice } from '@/lib/venum';

/**
 * Subscribes to Venum's real-time price stream via the same-origin SSE proxy
 * (`/api/prices/stream`, which injects the API key server-side). Maintains a
 * live map of token -> latest price so the graph / stats can show real,
 * multi-DEX prices without polling GeckoTerminal.
 *
 * Pass the symbols or mints you want to watch. Pass `null`/`[]` to disconnect.
 */

interface UseVenumPriceStreamReturn {
  /** Latest price per token (keyed by the symbol/mint you passed). */
  prices: Record<string, VenumPrice>;
  connected: boolean;
  error: string | null;
  /** Wall-clock time of the last received `price` event, or null. */
  lastUpdate: number | null;
}

export function useVenumPriceStream(
  tokens: string[] | null,
  options: { includeOptimistic?: boolean } = {}
): UseVenumPriceStreamReturn {
  const [prices, setPrices] = useState<Record<string, VenumPrice>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const sourceRef = useRef<EventSource | null>(null);
  const { includeOptimistic } = options;

  // Stable key so the effect only re-subscribes when the token set changes.
  const tokenKey = tokens && tokens.length > 0 ? tokens.slice().sort().join(',') : '';

  useEffect(() => {
    // No tokens: nothing to open. Any prior connection was closed by this
    // effect's cleanup when tokenKey changed, so there is nothing to do here.
    if (!tokenKey) return;

    const params = new URLSearchParams({ tokens: tokenKey });
    if (includeOptimistic) params.set('includeOptimistic', 'true');

    const es = new EventSource(`/api/prices/stream?${params.toString()}`);
    sourceRef.current = es;

    es.addEventListener('ready', () => {
      setConnected(true);
      setError(null);
    });

    es.addEventListener('price', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as VenumPrice;
        if (!data?.token) return;
        setPrices(prev => ({ ...prev, [data.token]: data }));
        setLastUpdate(Date.now());
      } catch {
        // Ignore malformed frames; the stream stays open.
      }
    });

    // `heartbeat` events just keep the connection alive, no handler needed.

    es.onerror = () => {
      // EventSource auto-reconnects; surface a soft error until it recovers.
      setConnected(false);
      setError('Price stream disconnected, retrying…');
    };

    return () => {
      es.close();
      if (sourceRef.current === es) sourceRef.current = null;
      setConnected(false);
    };
  }, [tokenKey, includeOptimistic]);

  return { prices, connected, error, lastUpdate };
}
