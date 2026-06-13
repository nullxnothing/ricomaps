'use client';

import { useState } from 'react';
import type { TokenMetadata, TokenSecurityInfo, RugScore } from '@/lib/types';
import { truncateAddress } from '@/lib/address-utils';

/**
 * Left rail — token identity & market data. Mirrors the redesign spec; fields with
 * no live data are simply omitted (no fake placeholders).
 */
interface TokenIdentityRailProps {
  metadata: TokenMetadata | null;
  security?: TokenSecurityInfo | null;
  rugScore?: RugScore;
  address: string | null;
  className?: string;
}

function formatCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(p: number): string {
  return p < 0.001 ? `$${p.toExponential(2)}` : p < 1 ? `$${p.toFixed(6)}` : `$${p.toFixed(4)}`;
}

export function TokenIdentityRail({ metadata, security, rugScore, address, className }: TokenIdentityRailProps) {
  const [copied, setCopied] = useState(false);
  if (!metadata) return null;

  const symbol = metadata.symbol;
  const marketCells: { label: string; value: string }[] = [];
  if (metadata.marketCap != null) marketCells.push({ label: 'MKT CAP', value: formatCompact(metadata.marketCap) });
  if (metadata.volume24h != null) marketCells.push({ label: 'VOL 24H', value: formatCompact(metadata.volume24h) });
  if (metadata.liquidity != null) marketCells.push({ label: 'LIQUIDITY', value: formatCompact(metadata.liquidity) });
  if (metadata.fdv != null) marketCells.push({ label: 'FDV', value: formatCompact(metadata.fdv) });

  const copyCA = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside className={`rail rail--left ${className ?? ''}`} style={{ width: 308 }} aria-label="Token identity">
      {/* Header */}
      <div className="flex items-center gap-3">
        {metadata.image?.startsWith('https://') ? (
          <img
            src={metadata.image}
            alt=""
            className="w-[46px] h-[46px] rounded-xl object-cover border border-white/10 flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div
            className="w-[46px] h-[46px] rounded-xl flex items-center justify-center flex-shrink-0 font-mono text-[11px] font-bold text-green-primary border border-green-primary/20"
            style={{ background: 'radial-gradient(circle at 50% 40%, rgba(0,255,65,0.18), rgba(0,255,65,0.03))' }}
          >
            {(symbol || metadata.name || '?').slice(0, 4).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[17px] font-bold leading-tight truncate text-text-primary">{metadata.name || 'Unknown'}</div>
          {symbol && <div className="text-[12px] font-mono text-text-tertiary leading-tight">${symbol}</div>}
        </div>
      </div>

      {/* Authority badges */}
      {security && (
        <div className="flex flex-wrap gap-1.5">
          {rugScore && (
            <span className={`auth-badge ${rugScore.level === 'red' ? 'auth-badge--red' : rugScore.level === 'yellow' ? 'auth-badge--amber' : 'auth-badge--green'}`}>
              RUG {rugScore.score}
            </span>
          )}
          <span className={`auth-badge ${security.hasFreezeAuthority ? 'auth-badge--red' : 'auth-badge--green'}`}>
            {security.hasFreezeAuthority ? 'Freeze' : 'No Freeze'}
          </span>
          <span className={`auth-badge ${security.hasMintAuthority ? 'auth-badge--amber' : 'auth-badge--green'}`}>
            {security.hasMintAuthority ? 'Mintable' : 'No Mint'}
          </span>
          {security.isMutable && <span className="auth-badge auth-badge--amber">Mutable</span>}
        </div>
      )}

      {/* Price card */}
      {metadata.priceUsd != null && (
        <div className="surface-card p-3.5">
          <div className="section-label" style={{ letterSpacing: '0.14em' }}>PRICE</div>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="text-[21px] font-bold font-mono text-text-primary">{formatPrice(metadata.priceUsd)}</span>
            {metadata.priceChange24h != null && (
              <span className={`text-[12.5px] font-bold font-mono ${metadata.priceChange24h >= 0 ? 'text-green-primary' : 'text-red-primary'}`}>
                {metadata.priceChange24h >= 0 ? '+' : ''}{metadata.priceChange24h.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Market grid */}
      {marketCells.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {marketCells.map((c) => (
            <div key={c.label} className="market-cell">
              <div className="font-mono text-[9.5px] text-text-tertiary">{c.label}</div>
              <div className="font-mono text-[14px] font-semibold text-text-primary mt-0.5">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Description */}
      {metadata.description && (
        <p className="text-[11.5px] leading-[1.65] text-text-tertiary line-clamp-4">{metadata.description}</p>
      )}

      {/* Contract chip */}
      {address && (
        <button className="rail-chip" onClick={copyCA} title="Copy contract address">
          <span className="font-mono text-[11px] text-text-tertiary">{truncateAddress(address, 6)}</span>
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green-primary)" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-tertiary">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      )}

      {/* Socials */}
      {(metadata.website || metadata.twitter || metadata.telegram || metadata.dexUrl) && (
        <div className="flex items-center gap-2">
          {metadata.website && (
            <a href={metadata.website} target="_blank" rel="noopener noreferrer" className="social-btn" title="Website">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" /></svg>
            </a>
          )}
          {metadata.twitter && (
            <a href={metadata.twitter.startsWith('http') ? metadata.twitter : `https://x.com/${metadata.twitter}`} target="_blank" rel="noopener noreferrer" className="social-btn" title="X">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
            </a>
          )}
          {metadata.telegram && (
            <a href={metadata.telegram.startsWith('http') ? metadata.telegram : `https://t.me/${metadata.telegram}`} target="_blank" rel="noopener noreferrer" className="social-btn" title="Telegram">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
            </a>
          )}
          {metadata.dexUrl && (
            <a href={metadata.dexUrl} target="_blank" rel="noopener noreferrer" className="social-btn" title="Chart">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
            </a>
          )}
        </div>
      )}
    </aside>
  );
}

export default TokenIdentityRail;
