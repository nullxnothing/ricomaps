'use client';

import Link from 'next/link';

/**
 * Token Map / Atlas view switch. Routes between `/` and `/atlas`; the active
 * view is driven by the page that renders it (not pathname) so it stays correct
 * during the graph view on `/`.
 */
interface SegmentedSwitchProps {
  active: 'token' | 'atlas';
}

export function SegmentedSwitch({ active }: SegmentedSwitchProps) {
  return (
    <div className="segmented" role="tablist" aria-label="View">
      <Link href="/" className={active === 'token' ? 'active' : ''} role="tab" aria-selected={active === 'token'}>
        Token Map
      </Link>
      <Link href="/atlas" className={active === 'atlas' ? 'active' : ''} role="tab" aria-selected={active === 'atlas'}>
        Atlas
      </Link>
    </div>
  );
}

export default SegmentedSwitch;
