'use client';

import { useState, useEffect } from 'react';
import { EnrichedToken, TrendingResponse } from '@/lib/types';
import { TokenCard } from './TokenCard';

interface TrendingTokensProps {
  onTokenClick: (address: string) => void;
}

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
        <div className="trending-loading">
          <div className="spinner-lg" />
          <p>Loading trending tokens...</p>
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
