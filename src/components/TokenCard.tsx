'use client';

import { EnrichedToken } from '@/lib/types';
import { formatMarketCap } from '@/lib/format';

interface TokenCardProps {
  token: EnrichedToken;
  rank: number;
  onClick: (address: string) => void;
}

function formatPrice(price: number): string {
  if (price < 0.00001) return `$${price.toExponential(2)}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  if (price < 1000) return `$${price.toFixed(2)}`;
  return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatVolume(volume: number): string {
  if (volume >= 1e9) return `$${(volume / 1e9).toFixed(2)}B`;
  if (volume >= 1e6) return `$${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `$${(volume / 1e3).toFixed(1)}K`;
  return `$${volume.toFixed(0)}`;
}

export function TokenCard({ token, rank, onClick }: TokenCardProps) {
  const isPositive = token.priceChange24h >= 0;
  const priceChangeColor = isPositive ? '#10b981' : '#ef4444';
  const priceChangeSign = isPositive ? '+' : '';

  return (
    <div
      className="token-card"
      onClick={() => onClick(token.address)}
    >
      <div className="token-rank">{rank}</div>

      <img
        src={token.icon}
        alt={token.symbol}
        className="token-icon"
        onError={(e) => {
          (e.target as HTMLImageElement).src = '/favicon.png';
        }}
      />

      <div className="token-info">
        <div className="token-name">{token.name}</div>
        <div className="token-symbol">{token.symbol}</div>
      </div>

      <div className="token-metrics">
        <div className="token-price">{formatPrice(token.priceUsd)}</div>
        <div
          className="token-change"
          style={{ color: priceChangeColor }}
        >
          {priceChangeSign}{token.priceChange24h.toFixed(2)}%
        </div>
      </div>

      <div className="token-volume">
        <div className="volume-label">Vol 24h</div>
        <div className="volume-value">{formatVolume(token.volume24h)}</div>
      </div>

      <div className="token-mcap">
        <div className="mcap-label">MCap</div>
        <div className="mcap-value">{formatMarketCap(token.marketCap)}</div>
      </div>
    </div>
  );
}

export default TokenCard;
