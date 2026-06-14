import { mapTokenHolders } from '@/lib/holder-mapper';
import { getCachedTokenScan } from '@/lib/db-cache';
import { getXIdentityByUsername, trackHandles, normalizeHandle } from '@/lib/x-account-history';
import type { TokenMetadata, XAccountIdentity } from '@/lib/types';
import type { ScanResultLike } from '@/lib/telegram/format';

export type { ScanResultLike };

/**
 * Resolve a token's X handle against the recycled-account tracker. Always queues the
 * handle for daily tracking (so the timeline keeps building); returns the identity
 * only when it's KNOWN-RECYCLED, so the bots surface a warning only on a real signal.
 */
async function resolveXAccount(meta: TokenMetadata | null): Promise<XAccountIdentity | null> {
  const handle = normalizeHandle(meta?.twitter ?? meta?.twitterHandle);
  if (!handle) return null;
  try {
    void trackHandles([handle]);            // fire-and-forget: build the timeline over time
    const identity = await getXIdentityByUsername(handle);
    return identity?.isRecycled ? identity : null;
  } catch {
    return null;
  }
}

interface ScanOptions {
  /** Skip the cache and force a fresh scan. */
  force?: boolean;
  /** Holder depth; defaults to the lightweight quick-scan value. */
  topN?: number;
}

/**
 * Cache-first forensic scan, shared by every surface (Telegram, X, API).
 * Returns the structured forensic result minus the heavy GraphData. The scan
 * engine itself (`mapTokenHolders`) has no channel coupling, so any caller can
 * reuse this.
 */
export async function scanTokenForensics(mint: string, options: ScanOptions = {}): Promise<ScanResultLike> {
  if (!options.force) {
    const cached = await getCachedTokenScan(mint);
    if (cached) {
      return {
        stats: cached.stats as ScanResultLike['stats'],
        tokenSecurity: cached.tokenSecurity,
        tokenMetadata: cached.tokenMetadata,
        deployerInfo: cached.deployerInfo,
        xAccount: await resolveXAccount(cached.tokenMetadata),
      };
    }
  }
  const result = await mapTokenHolders(mint, { topN: options.topN ?? 15, fundersPerHolder: 1 });
  return {
    stats: result.stats,
    tokenSecurity: result.tokenSecurity,
    tokenMetadata: result.tokenMetadata,
    deployerInfo: result.deployerInfo,
    xAccount: await resolveXAccount(result.tokenMetadata),
  };
}
