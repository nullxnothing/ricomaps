'use client';

import { useGateContext } from './GateProvider';
import { truncateAddress } from '@/lib/address-utils';

/** Compact unlock/locked indicator for the navbar. */
export function GateButton() {
  const { unlocked, address, loading, error, unlock, lock } = useGateContext();

  if (unlocked && address) {
    return (
      <button
        type="button"
        onClick={lock}
        title="Holder unlocked, click to disconnect"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
        style={{ background: 'var(--green-ghost)', color: 'var(--green-primary)', border: '1px solid rgba(0,255,65,0.25)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--green-primary)' }} />
        {truncateAddress(address, 3)}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={unlock}
        disabled={loading}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-60"
        style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-base)' }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        {loading ? 'Verifying…' : 'Unlock'}
      </button>
      {error && <span className="text-[10px] max-w-[180px] text-right" style={{ color: 'var(--red-primary)' }}>{error}</span>}
    </div>
  );
}
