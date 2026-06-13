import { mapTokenHolders } from '@/lib/holder-mapper';
import { getCachedTokenScan } from '@/lib/db-cache';
import type { ScanResultLike } from '@/lib/telegram/format';

export type { ScanResultLike };

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
      };
    }
  }
  const result = await mapTokenHolders(mint, { topN: options.topN ?? 15, fundersPerHolder: 1 });
  return {
    stats: result.stats,
    tokenSecurity: result.tokenSecurity,
    tokenMetadata: result.tokenMetadata,
    deployerInfo: result.deployerInfo,
  };
}
