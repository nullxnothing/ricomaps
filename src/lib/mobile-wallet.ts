/**
 * Mobile wallet deep-linking.
 *
 * On desktop, Phantom/Solflare inject `window.solana`. On a phone's normal
 * browser there is no extension, so the only way to reach a wallet is to bounce
 * the user into the wallet app's in-app browser via a universal deep link — once
 * there, `window.solana` exists and the standard sign-to-verify flow works.
 */

export type MobileWallet = 'phantom' | 'solflare';

const MOBILE_UA_RE = /Android|iPhone|iPad|iPod|Mobile/i;

/** Coarse mobile detection: UA plus a touch/coarse-pointer check. */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const uaMobile = MOBILE_UA_RE.test(navigator.userAgent);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return uaMobile || coarse;
}

/** True when no injected Solana provider is present (no extension / not in-app). */
export function hasInjectedWallet(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { solana?: unknown; solflare?: unknown };
  return !!(w.solana || w.solflare);
}

/**
 * A mobile browser with no injected wallet — the dead-end state where the old
 * code showed "No Solana wallet found". This is the signal to offer deep links.
 */
export function needsMobileWalletDeepLink(): boolean {
  return isMobileDevice() && !hasInjectedWallet();
}

/**
 * Build the universal deep link that opens the current page inside a wallet's
 * in-app browser. We strip the protocol because Phantom expects a bare host+path
 * and re-appends `ref` so the wallet knows where the request originated.
 */
export function buildWalletBrowseLink(wallet: MobileWallet, targetUrl: string): string {
  const url = new URL(targetUrl);
  const ref = encodeURIComponent(url.origin);

  if (wallet === 'phantom') {
    // https://docs.phantom.com/phantom-deeplinks/provider-methods/browse
    const link = encodeURIComponent(url.toString());
    return `https://phantom.app/ul/browse/${link}?ref=${ref}`;
  }

  // Solflare universal link: https://docs.solflare.com/solflare/technical/deeplinks
  const noProto = url.toString().replace(/^https?:\/\//, '');
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(noProto)}?ref=${ref}`;
}

/** Redirect the current tab into the chosen wallet's in-app browser. */
export function openInWallet(wallet: MobileWallet): void {
  if (typeof window === 'undefined') return;
  window.location.href = buildWalletBrowseLink(wallet, window.location.href);
}
