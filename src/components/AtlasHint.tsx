'use client';

import { useEffect, useState } from 'react';

/**
 * One-time "what am I looking at" hint, shown over the map on first visit and
 * dismissed for the session. Pure orientation — no data.
 */

const SEEN_KEY = 'atlas-hint-seen';

export function AtlasHint({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) return;
    if (sessionStorage.getItem(SEEN_KEY)) return;
    const t = setTimeout(() => setVisible(true), 600); // let the map settle first
    return () => clearTimeout(t);
  }, [show]);

  const dismiss = () => {
    sessionStorage.setItem(SEEN_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="absolute inset-x-0 bottom-24 flex justify-center pointer-events-none px-4">
      <div
        className="glass-panel px-4 py-3 max-w-[440px] pointer-events-auto flex items-start gap-3"
        style={{ animation: 'slideUp 0.3s ease-out' }}
      >
        <span className="mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 bg-red-primary" style={{ animation: 'tx-pulse 2s ease-in-out infinite' }} />
        <p className="text-[12.5px] leading-relaxed text-text-secondary flex-1">
          Each <span className="text-red-primary font-semibold">●</span> is a coordinated crew. Lines run to the
          tokens they control. Click a crew to see its bags, PnL, and history — or watch the beams when they buy.
        </p>
        <button
          onClick={dismiss}
          className="font-mono text-[10px] uppercase tracking-[0.06em] text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0 mt-0.5"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
