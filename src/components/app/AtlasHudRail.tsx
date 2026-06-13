'use client';

import type { AtlasStats } from '@/lib/types';
import { formatUsd } from '@/lib/format';

/**
 * Atlas left HUD rail (250px): live status, headline counts, and a hint.
 */
interface AtlasHudRailProps {
  stats: AtlasStats | null;
  live: boolean;
  streamSupported: boolean;
  className?: string;
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="market-cell">
      <div className="font-mono text-[9.5px] tracking-[0.08em] text-text-tertiary uppercase">{label}</div>
      <div className="font-mono text-[20px] font-bold mt-0.5" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

export function AtlasHudRail({ stats, live, streamSupported, className }: AtlasHudRailProps) {
  return (
    <aside className={`rail rail--left ${className ?? ''}`} style={{ width: 250 }} aria-label="Atlas status">
      <div className="flex items-center gap-2">
        <span className={live ? 'rm-live-dot' : 'w-[7px] h-[7px] rounded-full'} style={live ? undefined : { background: 'var(--text-tertiary)' }} />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-green-primary">
          {live ? 'Live Cabal Map' : streamSupported ? 'Connecting…' : 'Cabal Map'}
        </span>
      </div>

      <p className="text-[11.5px] leading-snug text-text-tertiary">
        Every active crew on pump.fun — launches, graduations, coordinated buys, and rugs as they happen.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Active Crews" value={stats ? String(stats.cabalsActive24h) : '—'} />
        <StatCard label="Tokens" value={stats ? String(stats.tokensTracked) : '—'} />
        <StatCard label="Rugs Today" value={stats ? String(stats.rugs24h) : '—'} color={stats && stats.rugs24h > 0 ? 'var(--red-primary)' : undefined} />
        <StatCard label="Extracted" value={stats && stats.totalExtractedUsd > 0 ? formatUsd(stats.totalExtractedUsd) : '—'} color="var(--amber-primary)" />
      </div>

      <div className="surface-card p-2.5" style={{ borderRadius: 9 }}>
        <p className="font-mono text-[10px] leading-snug text-text-tertiary">
          Crews are fingerprinted across launches by shared funding wallets. Click a crew node to open its dossier.
        </p>
      </div>
    </aside>
  );
}

export default AtlasHudRail;
