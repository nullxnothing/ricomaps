'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GraphData } from '@/lib/types';

interface HolderSnapshot {
  owner: string;
  amount: number;
}

interface PollResponse {
  holders: HolderSnapshot[];
  removed?: string[];
  totalHolders: number;
  timestamp: number;
  lastSlot?: number;
  isIncremental?: boolean;
}

interface HolderDiff {
  added: HolderSnapshot[];   // New holders not in graph
  removed: string[];          // Holders that sold everything
  changed: HolderSnapshot[];  // Holders with balance changes
}

interface UseHolderPollingReturn {
  isPolling: boolean;
  lastPollTime: number | null;
  pollCount: number;
  diff: HolderDiff | null;
  error: string | null;
  start: () => void;
  stop: () => void;
}

const POLL_INTERVAL = 10_000; // 10 seconds

export function useHolderPolling(
  mint: string | null,
  data: GraphData | null,
  onDiff: (diff: HolderDiff) => void,
): UseHolderPollingReturn {
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollTime, setLastPollTime] = useState<number | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [diff, setDiff] = useState<HolderDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const dataRef = useRef<GraphData | null>(null);
  const onDiffRef = useRef(onDiff);
  const activeRef = useRef(false);
  const lastSlotRef = useRef<number | undefined>(undefined);

  dataRef.current = data;
  onDiffRef.current = onDiff;

  const poll = useCallback(async () => {
    if (!mint || !dataRef.current) return;

    try {
      const pollUrl = lastSlotRef.current !== undefined
        ? `/api/poll?mint=${mint}&limit=50&sinceSlot=${lastSlotRef.current}`
        : `/api/poll?mint=${mint}&limit=50`;
      const res = await fetch(pollUrl);
      if (!res.ok) throw new Error(`Poll failed: ${res.status}`);

      const { holders, removed: removedFromServer = [], timestamp, lastSlot, isIncremental }: PollResponse = await res.json();
      if (lastSlot !== undefined) {
        lastSlotRef.current = lastSlot;
      }
      setLastPollTime(timestamp);
      setPollCount(prev => prev + 1);
      setError(null);

      // Build current graph holder map (only holder-type nodes with token amounts)
      const currentHolders = new Map<string, number>();
      for (const node of dataRef.current!.nodes) {
        if (node.tokenAmount && node.tokenAmount > 0) {
          currentHolders.set(node.id, node.tokenAmount);
        }
      }

      // Build new holder map
      const newHolderMap = new Map<string, number>();
      for (const h of holders) {
        newHolderMap.set(h.owner, h.amount);
      }

      // Diff
      const added: HolderSnapshot[] = [];
      const removed: string[] = [];
      const changed: HolderSnapshot[] = [];

      // New or changed holders
      for (const h of holders) {
        if (h.amount <= 0) {
          if (currentHolders.has(h.owner)) removed.push(h.owner);
          continue;
        }

        const prev = currentHolders.get(h.owner);
        if (prev === undefined) {
          added.push(h);
        } else if (Math.abs(prev - h.amount) / Math.max(prev, 1) > 0.01) {
          // >1% change threshold to avoid noise
          changed.push(h);
        }
      }

      for (const owner of removedFromServer) {
        if (currentHolders.has(owner) && !removed.includes(owner)) removed.push(owner);
      }

      if (!isIncremental) {
        // Removed holders (were in graph, now have 0 or not in top holders)
        for (const [owner] of currentHolders) {
          if (!newHolderMap.has(owner)) {
            removed.push(owner);
          }
        }
      }

      const hasDiff = added.length > 0 || removed.length > 0 || changed.length > 0;

      if (hasDiff) {
        const d: HolderDiff = { added, removed, changed };
        setDiff(d);
        onDiffRef.current(d);

      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Poll failed';
      setError(msg);
      console.error('[Poll]', msg);
    }
  }, [mint]);

  const start = useCallback(() => {
    if (activeRef.current || !mint) return;
    activeRef.current = true;
    setIsPolling(true);
    setError(null);
    // First poll after a short delay (let scan settle)
    const timeout = setTimeout(() => {
      poll();
      intervalRef.current = setInterval(poll, POLL_INTERVAL);
    }, 3000);

    // Store timeout ref for cleanup
    intervalRef.current = timeout as unknown as NodeJS.Timeout;
  }, [mint, poll]);

  const stop = useCallback(() => {
    activeRef.current = false;
    setIsPolling(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      clearTimeout(intervalRef.current as unknown as NodeJS.Timeout);
      intervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        clearTimeout(intervalRef.current as unknown as NodeJS.Timeout);
      }
    };
  }, []);

  return { isPolling, lastPollTime, pollCount, diff, error, start, stop };
}
