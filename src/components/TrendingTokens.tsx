'use client';

import { useState, useEffect } from 'react';
import { EnrichedToken, TrendingResponse } from '@/lib/types';
import { TokenCard } from './TokenCard';

interface TrendingTokensProps {
  onTokenClick: (address: string) => void;
}

const SKELETON_TITLE_WIDTHS = ['66%', '78%', '58%', '84%', '72%'];

export function TrendingTokens({ onTokenClick }: TrendingTokensProps) {
  const [trending, setTrending] = useState<EnrichedToken[]>([]);
  const [featured, setFeatured] = useState<EnrichedToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTrendingTokens() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch('/api/trending');
        const data: TrendingResponse = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch trending tokens');
        }

        setTrending(data.trending);
        setFeatured(data.featured);
      } catch (err) {
        console.error('Failed to fetch trending tokens:', err);
        setError(err instanceof Error ? err.message : 'Failed to load trending tokens');
      } finally {
        setIsLoading(false);
      }
    }

    fetchTrendingTokens();
  }, []);

  if (isLoading) {
    return (
      <div className="trending-container">
        <h2 className="trending-title">Explore Tokens</h2>
        <div className="trending-grid">
          {[0, 1].map(col => (
            <div key={col} className="trending-column">
              <div className="column-title">{col === 0 ? 'Trending' : 'Featured'}</div>
              <div className="token-list">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="token-card" style={{ pointerEvents: 'none' }}>
                    <div className="token-rank" style={{ opacity: 0.3 }}>{i + 1 + col * 10}</div>
                    <div className="w-7 h-7 rounded-full animate-pulse flex-shrink-0" style={{ background: 'var(--bg-elevated)' }} />
                    <div className="token-info">
                      <div className="h-3 rounded animate-pulse mb-1.5" style={{ background: 'var(--bg-elevated)', width: SKELETON_TITLE_WIDTHS[(i + col) % SKELETON_TITLE_WIDTHS.length] }} />
                      <div className="h-2.5 rounded animate-pulse" style={{ background: 'var(--bg-hover)', width: '30%' }} />
                    </div>
                    <div className="token-metrics">
                      <div className="h-3 rounded animate-pulse mb-1" style={{ background: 'var(--bg-elevated)', width: '60px', marginLeft: 'auto' }} />
                      <div className="h-2.5 rounded animate-pulse" style={{ background: 'var(--bg-hover)', width: '40px', marginLeft: 'auto' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trending-container">
        <div className="trending-error">
          <p>{error}</p>
          <button
            className="btn-primary"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="trending-container">
      <h2 className="trending-title">Explore Tokens</h2>

      <div className="trending-grid">
        {/* Trending Column */}
        <div className="trending-column">
          <h3 className="column-title">
            Trending
          </h3>
          <div className="token-list">
            {trending.map((token, index) => (
              <TokenCard
                key={token.address}
                token={token}
                rank={index + 1}
                onClick={onTokenClick}
              />
            ))}
          </div>
        </div>

        {/* Featured Column */}
        <div className="trending-column">
          <h3 className="column-title">
            Featured
          </h3>
          <div className="token-list">
            {featured.map((token, index) => (
              <TokenCard
                key={token.address}
                token={token}
                rank={index + 11}
                onClick={onTokenClick}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TrendingTokens;
