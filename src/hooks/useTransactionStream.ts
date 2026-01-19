'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { HeliusTransaction, GraphUpdate, GraphNode } from '@/lib/types';
import { processTransactionToGraphUpdate } from '@/lib/transaction-processor';

interface StreamEvent {
  type: 'connected' | 'transaction' | 'heartbeat' | 'error';
  address?: string;
  transaction?: HeliusTransaction;
  addresses?: string[];
  error?: string;
  timestamp: number;
}

interface UseTransactionStreamOptions {
  onNewTransaction?: (tx: HeliusTransaction, update: GraphUpdate) => void;
  onConnect?: (addresses: string[]) => void;
  onError?: (error: string, address?: string) => void;
  onHeartbeat?: () => void;
}

interface UseTransactionStreamReturn {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  transactionCount: number;
  lastHeartbeat: number | null;
  connect: (addresses: string[]) => void;
  disconnect: () => void;
}

export function useTransactionStream(
  existingNodes: GraphNode[],
  options: UseTransactionStreamOptions = {}
): UseTransactionStreamReturn {
  const {
    onNewTransaction,
    onConnect,
    onError,
    onHeartbeat,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionCount, setTransactionCount] = useState(0);
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const watchedAddressesRef = useRef<string[]>([]);
  const existingNodeIdsRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(false);

  // Update existing node IDs when nodes change
  useEffect(() => {
    existingNodeIdsRef.current = new Set(existingNodes.map(n => n.id));
  }, [existingNodes]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const connect = useCallback((addresses: string[]) => {
    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (addresses.length === 0) {
      setError('No addresses to watch');
      return;
    }

    setIsConnecting(true);
    setError(null);
    watchedAddressesRef.current = addresses;
    shouldReconnectRef.current = true;

    const url = `/api/stream?addresses=${addresses.join(',')}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[Stream] Connection opened');
    };

    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);

        switch (data.type) {
          case 'connected':
            setIsConnected(true);
            setIsConnecting(false);
            setError(null);
            onConnect?.(data.addresses || []);
            console.log('[Stream] Connected, watching:', data.addresses);
            break;

          case 'transaction':
            if (data.transaction) {
              // Process transaction to graph update
              const update = processTransactionToGraphUpdate(
                data.transaction,
                watchedAddressesRef.current,
                existingNodeIdsRef.current
              );

              // Only call callback if there are new nodes or links
              if (update.newNodes.length > 0 || update.newLinks.length > 0) {
                setTransactionCount(prev => prev + 1);
                onNewTransaction?.(data.transaction, update);
                console.log('[Stream] New transaction:', data.transaction.signature?.slice(0, 8));
              }
            }
            break;

          case 'heartbeat':
            setLastHeartbeat(data.timestamp);
            onHeartbeat?.();
            break;

          case 'error':
            console.error('[Stream] Error:', data.error, data.address);
            onError?.(data.error || 'Unknown error', data.address);
            break;
        }
      } catch (err) {
        console.error('[Stream] Failed to parse event:', err);
      }
    };

    eventSource.onerror = () => {
      console.error('[Stream] EventSource error');
      setError('Connection lost');
      setIsConnected(false);
      setIsConnecting(false);

      // Auto-reconnect after 5 seconds if we should still be connected
      if (shouldReconnectRef.current && watchedAddressesRef.current.length > 0) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (shouldReconnectRef.current && watchedAddressesRef.current.length > 0) {
            console.log('[Stream] Attempting reconnect...');
            // Re-create connection directly instead of calling connect
            const reconnectUrl = `/api/stream?addresses=${watchedAddressesRef.current.join(',')}`;
            const newEventSource = new EventSource(reconnectUrl);
            eventSourceRef.current = newEventSource;
            setIsConnecting(true);
            // Copy the same handlers
            newEventSource.onopen = eventSource.onopen;
            newEventSource.onmessage = eventSource.onmessage;
            newEventSource.onerror = eventSource.onerror;
          }
        }, 5000);
      }
    };
  }, [onConnect, onError, onHeartbeat, onNewTransaction]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return {
    isConnected,
    isConnecting,
    error,
    transactionCount,
    lastHeartbeat,
    connect,
    disconnect,
  };
}

export default useTransactionStream;
