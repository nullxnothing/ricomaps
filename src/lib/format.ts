// Shared display formatters. Keep these canonical: do not reimplement per-component.

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/**
 * Abbreviated USD amount, e.g. $1.2M / $3.4K / $5.67.
 * Values under a cent collapse to "<$0.01".
 */
export function formatUsd(value: number): string {
  if (value < 0.01) return '<$0.01';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * Abbreviated bare number (no currency), e.g. 1.20B / 3.40M / 5.6K.
 * Used for token amounts and market caps.
 */
export function formatCompact(value: number, decimals = 2): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(decimals)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(decimals)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(decimals)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  if (value < 0.01) return value.toFixed(6);
  return value.toFixed(decimals);
}

/** Abbreviated market cap with $ prefix, e.g. $1.20B / $3.40M / $5.6K / $42. */
export function formatMarketCap(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * Relative time from a unix timestamp (seconds).
 * Sub-minute renders as "Ns ago" by default, or "just now" when `coarse` is set.
 */
export function timeAgo(timestampSeconds: number, coarse = false): string {
  const seconds = Math.floor(Date.now() / 1000 - timestampSeconds);
  if (seconds < SECONDS_PER_MINUTE) return coarse ? 'just now' : `${seconds}s ago`;
  if (seconds < SECONDS_PER_HOUR) return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ago`;
  if (seconds < SECONDS_PER_DAY) return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ago`;
  return `${Math.floor(seconds / SECONDS_PER_DAY)}d ago`;
}
