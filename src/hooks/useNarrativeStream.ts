'use client';

import { useState, useCallback, useRef } from 'react';
import { NarrativeBrief } from '@/lib/narrative-prompt';

interface NarrativeResult {
  narrative: string;
  factors: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface UseNarrativeStreamReturn {
  text: string;
  factors: string[];
  confidence: 'high' | 'medium' | 'low' | null;
  isStreaming: boolean;
  isDone: boolean;
  error: string | null;
  gated: boolean;
  generate: (mint: string | null, brief: NarrativeBrief) => Promise<void>;
  reset: () => void;
}

// POSTs to /api/explain and parses the SSE-formatted ReadableStream body.
// (EventSource can't POST, so we read the stream and split on SSE frames.)
export function useNarrativeStream(): UseNarrativeStreamReturn {
  const [text, setText] = useState('');
  const [factors, setFactors] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setText(''); setFactors([]); setConfidence(null);
    setIsStreaming(false); setIsDone(false); setError(null); setGated(false);
  }, []);

  const generate = useCallback(async (mint: string | null, brief: NarrativeBrief) => {
    reset();
    setIsStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint, brief }),
        signal: ctrl.signal,
      });

      if (res.status === 403) { setGated(true); setIsStreaming(false); return; }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'Narrative unavailable'); setIsStreaming(false); return;
      }

      // Cached responses come back as plain JSON, not a stream.
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const j = (await res.json()) as NarrativeResult;
        setText(j.narrative); setFactors(j.factors); setConfidence(j.confidence);
        setIsStreaming(false); setIsDone(true); return;
      }

      const reader = res.body?.getReader();
      if (!reader) { setError('No stream'); setIsStreaming(false); return; }
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const eventLine = frame.split('\n').find(l => l.startsWith('event:'));
          const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim());

          if (event === 'token') setText(prev => prev + data.text);
          else if (event === 'done') {
            setFactors(data.factors ?? []);
            setConfidence(data.confidence ?? null);
            setIsDone(true);
          } else if (event === 'error') setError(data.message ?? 'Generation failed');
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Connection failed');
    } finally {
      setIsStreaming(false);
    }
  }, [reset]);

  return { text, factors, confidence, isStreaming, isDone, error, gated, generate, reset };
}
