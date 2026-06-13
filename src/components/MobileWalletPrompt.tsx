'use client';

import type { MobileWallet } from '@/lib/mobile-wallet';

interface MobileWalletPromptProps {
  open: boolean;
  onClose: () => void;
  onOpenWallet: (wallet: MobileWallet) => void;
}

/**
 * Shown when a phone user with no injected wallet tries to unlock. Mobile
 * browsers can't host wallet extensions, so we deep-link into the wallet app's
 * in-app browser, where the standard connect/sign flow works.
 */
export function MobileWalletPrompt({ open, onClose, onOpenWallet }: MobileWalletPromptProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:w-[420px] max-w-[calc(100vw-1.5rem)] mb-3 sm:mb-0 rounded-2xl border border-white/[0.08] bg-bg-base p-5 shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
        style={{ animation: 'slideUp 0.2s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-base font-bold text-text-primary">Connect a mobile wallet</h2>
          <button onClick={onClose} aria-label="Close" className="topbar-iconbtn !w-7 !h-7 -mr-1 -mt-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-[12.5px] leading-relaxed text-text-tertiary mb-4">
          Phone browsers can&apos;t run wallet extensions. Open RicoMaps inside your wallet&apos;s
          built-in browser to connect — we&apos;ll take you there.
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={() => onOpenWallet('phantom')}
            className="flex items-center justify-center gap-2.5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(180deg, #6f5cf5, #5644d6)' }}
          >
            Open in Phantom
          </button>
          <button
            onClick={() => onOpenWallet('solflare')}
            className="flex items-center justify-center gap-2.5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(180deg, #fc7227, #e85d12)' }}
          >
            Open in Solflare
          </button>
        </div>

        <p className="mt-3.5 text-[11px] leading-relaxed text-text-faint">
          Already in a wallet browser? Make sure the wallet is unlocked, then try again.
        </p>
      </div>
    </div>
  );
}

export default MobileWalletPrompt;
