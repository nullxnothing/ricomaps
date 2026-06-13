'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { isValidSolanaAddress } from '@/lib/address-utils';
import { BrandMark } from './BrandMark';
import { SegmentedSwitch } from './SegmentedSwitch';

const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface TopBarProps {
  active: 'token' | 'atlas';
  /** Scan handler; if omitted (atlas) the search submits to the token map. */
  onScan?: (address: string) => void;
  isLoading?: boolean;
  isDetecting?: boolean;
  /** Back button: shown only when a graph is loaded. */
  onBack?: () => void;
  onShare?: () => void;
  shareCopied?: boolean;
}

export function TopBar({ active, onScan, isLoading, isDetecting, onBack, onShare, shareCopied }: TopBarProps) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const invalid = trimmed.length > 0 && !ADDR_RE.test(trimmed);
  const busy = !!isLoading || !!isDetecting;

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!trimmed || !isValidSolanaAddress(trimmed)) return;
      if (onScan) {
        onScan(trimmed);
      } else {
        // Atlas: no local scan handler — deep-link into the token map.
        window.location.href = `/?address=${trimmed}`;
      }
    },
    [trimmed, onScan]
  );

  return (
    <header className="app-topbar">
      {/* Left: back + brand */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        {onBack ? (
          <button onClick={onBack} className="topbar-iconbtn" title="Back" aria-label="Back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <Link href="/" className="topbar-iconbtn" title="Home" aria-label="Home">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" />
            </svg>
          </Link>
        )}
        <Link href="/" className="flex items-center gap-2 select-none" aria-label="RicoMaps home">
          <span className="brand-chip">
            <BrandMark />
          </span>
          <span className="text-[15px] font-bold text-text-primary hidden sm:inline" style={{ letterSpacing: '-0.02em' }}>
            RicoMaps
          </span>
        </Link>
      </div>

      {/* Center: search */}
      <form onSubmit={submit} className="topbar-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary flex-shrink-0">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search token or wallet address…"
          spellCheck={false}
          disabled={busy}
          aria-label="Search token or wallet address"
        />
        <button type="submit" className="topbar-scan" disabled={busy || !trimmed || invalid}>
          {isDetecting ? (
            <span className="spinner" style={{ borderTopColor: '#03100a', borderColor: 'rgba(3,16,10,0.3)' }} />
          ) : isLoading ? (
            <span className="spinner" style={{ borderTopColor: '#03100a', borderColor: 'rgba(3,16,10,0.3)' }} />
          ) : (
            'Scan'
          )}
        </button>
      </form>

      {/* Right: view switch + share. Switch is hidden on phones to keep the
          Scan button on-screen; the view is reachable from the home nav. */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <div className="hidden sm:block">
          <SegmentedSwitch active={active} />
        </div>
        <button onClick={onShare} className="topbar-iconbtn" title={shareCopied ? 'Link copied' : 'Share'} aria-label="Share">
          {shareCopied ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--green-primary)" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}

export default TopBar;
