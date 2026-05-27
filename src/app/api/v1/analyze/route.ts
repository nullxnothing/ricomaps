import { NextRequest, NextResponse } from 'next/server';
import { mapTokenHolders } from '@/lib/holder-mapper';
import { isValidSolanaAddress } from '@/lib/address-utils';

const MAX_REQUESTS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

interface RateEntry {
  count: number;
  windowStart: number;
}

const apiKeyRateLimits = new Map<string, RateEntry>();

// Prune stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of apiKeyRateLimits) {
    if (now - entry.windowStart > WINDOW_MS) apiKeyRateLimits.delete(key);
  }
}, 5 * 60_000);

function checkApiKeyRateLimit(apiKey: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = apiKeyRateLimits.get(apiKey);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    apiKeyRateLimits.set(apiKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
    const retryAfterMs = WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

function validateApiKey(key: string): boolean {
  const validKeys = process.env.RICO_API_KEYS?.split(',').map(k => k.trim()).filter(Boolean) || [];
  return validKeys.includes(key);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mint, apiKey } = body;

    // Validate API key
    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing apiKey' },
        { status: 401 }
      );
    }

    if (!validateApiKey(apiKey)) {
      return NextResponse.json(
        { success: false, error: 'Invalid API key' },
        { status: 403 }
      );
    }

    // Rate limit per API key
    const { allowed, retryAfterMs } = checkApiKeyRateLimit(apiKey);
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    // Validate mint
    if (!mint || typeof mint !== 'string' || !isValidSolanaAddress(mint)) {
      return NextResponse.json(
        { success: false, error: 'Invalid Solana mint address' },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    const result = await mapTokenHolders(mint, { topN: 30, fundersPerHolder: 5 });
    const elapsed = Date.now() - startTime;

    // Compute summary
    const cabalNodes = result.data.nodes.filter(n => n.type === 'cabal-funder');
    const holderNodes = result.data.nodes.filter(n =>
      n.type === 'holder' || n.type === 'connected' || n.type === 'sniper' || n.type === 'bundled'
    );

    const riskScore = computeRiskScore(result.stats, cabalNodes.length, holderNodes.length);

    return NextResponse.json({
      success: true,
      nodes: result.data.nodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.label,
        tokenAmount: n.tokenAmount,
        solBalance: n.solBalance,
        identity: n.identity,
        metadata: n.metadata,
      })),
      links: result.data.links.map(l => ({
        source: l.source,
        target: l.target,
        value: l.value,
        suspicious: l.suspicious,
      })),
      summary: {
        totalHolders: result.stats.totalHolders,
        cabalCount: cabalNodes.length,
        riskScore,
        snipersDetected: result.stats.snipersDetected,
        bundleClustersDetected: result.stats.bundleClustersDetected,
      },
      tokenSecurity: result.tokenSecurity,
      tokenMetadata: result.tokenMetadata,
      timestamp: new Date().toISOString(),
      creditsUsed: result.stats.analyzedHolders * 100 + 50,
      processingMs: elapsed,
    });
  } catch (error) {
    console.error('v1/analyze error:', error);
    return NextResponse.json(
      { success: false, error: 'Analysis failed' },
      { status: 500 }
    );
  }
}

function computeRiskScore(
  stats: { cabalConnectionsFound: number; snipersDetected: number; bundleClustersDetected: number; analyzedHolders: number },
  cabalCount: number,
  holderCount: number
): number {
  let score = 0;
  const holderBase = Math.max(holderCount, 1);

  // Cabal funders relative to holder count
  score += Math.min(40, (cabalCount / holderBase) * 100);

  // Cabal connections density
  score += Math.min(25, (stats.cabalConnectionsFound / holderBase) * 50);

  // Snipers
  score += Math.min(20, (stats.snipersDetected / holderBase) * 60);

  // Bundle clusters
  score += Math.min(15, stats.bundleClustersDetected * 5);

  return Math.round(Math.min(100, score));
}
