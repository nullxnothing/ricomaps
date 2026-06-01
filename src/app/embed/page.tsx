'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { GraphNode, GraphData, ScanResponse } from '@/lib/types';

const BubbleMap = dynamic(
  () => import('@/components/BubbleMap').then((mod) => mod.BubbleMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--bg-void)' }}>
        <div className="font-mono text-sm" style={{ color: 'var(--green-primary)' }}>LOADING...</div>
      </div>
    ),
  }
);

function EmbedContent() {
  const searchParams = useSearchParams();
  const address = searchParams.get('address') || searchParams.get('a');
  const compact = searchParams.get('compact') === '1' || searchParams.get('compact') === 'true';
  // Compact mode (extension inline panel) also hides the watermark for a clean small view.
  const hideWatermark = compact || searchParams.get('hideWatermark') === 'true';

  const [data, setData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    if (!address) return;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      // Progressive paint: a fast quick-scan (15 holders, cache-first) runs in parallel
      // with the authoritative scan. Paint the quick result first if it lands first; the
      // full result wins once it resolves and BubbleMap merges it incrementally (no relayout).
      let fullResolved = false;
      fetch('/api/v1/quick-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })
        .then(r => r.json())
        .then((quick: ScanResponse) => {
          if (fullResolved || !quick.success || !quick.data) return;
          setData(quick.data);
          setIsLoading(false);
        })
        .catch(() => {}); // best-effort (e.g. wallet addresses) — ignore

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address }),
        });
        fullResolved = true;

        const result: ScanResponse = await response.json();

        if (!result.success || !result.data) {
          throw new Error(result.error || 'Scan failed');
        }

        setData(result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [address]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  if (!address) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ background: 'var(--bg-void)', color: 'var(--text-tertiary)' }}>
        <p className="font-mono text-sm">No address provided</p>
        <p className="text-xs mt-2">Add ?address=YOUR_ADDRESS to the URL</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ background: 'var(--bg-void)' }}>
        <div className="spinner-lg mb-4" />
        <p className="font-mono text-sm" style={{ color: 'var(--green-primary)' }}>SCANNING...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center" style={{ background: 'var(--bg-void)' }}>
        <p className="font-mono text-sm" style={{ color: 'var(--red-primary)' }}>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--bg-void)' }}>
        <div className="spinner-lg" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" style={{ background: 'var(--bg-void)' }}>
      <div className="absolute inset-0">
        <BubbleMap data={data} onNodeClick={handleNodeClick} />
      </div>

      {selectedNode && (
        <div className={`absolute bottom-0 left-0 right-0 glass-panel rounded-none rounded-t-xl ${compact ? 'p-2 sm:bottom-2 sm:left-2 sm:right-auto sm:max-w-[220px] sm:rounded-lg' : 'p-3 sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-[280px] sm:rounded-lg'}`}>
          <div className="flex items-center justify-between mb-2">
            <span
              className="px-2 py-0.5 text-[10px] font-mono rounded"
              style={{
                backgroundColor:
                  selectedNode.type === 'cabal-funder' ? 'var(--red-ghost)'
                  : selectedNode.type === 'token' ? 'var(--amber-ghost)'
                  : 'var(--green-ghost)',
                color:
                  selectedNode.type === 'cabal-funder' ? 'var(--red-primary)'
                  : selectedNode.type === 'token' ? 'var(--amber-primary)'
                  : 'var(--green-primary)',
              }}
            >
              {selectedNode.type?.toUpperCase() || 'WALLET'}
            </span>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              &times;
            </button>
          </div>
          <a
            href={`https://orbmarkets.io/address/${selectedNode.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs break-all hover:underline"
            style={{ color: 'var(--green-primary)' }}
          >
            {selectedNode.id.slice(0, 8)}...{selectedNode.id.slice(-6)}
          </a>
          {selectedNode.solBalance && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Balance: {selectedNode.solBalance.toFixed(4)} SOL
            </p>
          )}
        </div>
      )}

      {!hideWatermark && (
        <a
          href="https://ricomaps.com"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-all glass-panel"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <span>Powered by</span>
          <span className="font-bold" style={{ color: 'var(--green-primary)' }}>RicoMaps</span>
        </a>
      )}
    </div>
  );
}

export default function EmbedPage() {
  return (
    <main className="w-screen h-screen overflow-hidden" style={{ background: 'var(--bg-void)' }}>
      <Suspense
        fallback={
          <div className="w-full h-full flex items-center justify-center" style={{ background: 'var(--bg-void)' }}>
            <div className="spinner-lg" />
          </div>
        }
      >
        <EmbedContent />
      </Suspense>
    </main>
  );
}
