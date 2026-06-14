import { isDangerous, getWalletLabel } from '@/lib/wallet-labels';
import { isValidSolanaAddress } from '@/lib/address-utils';

// Lightweight group scam guard (Phanes-parity: auto-flag drainer links). This is a
// WARN-only guard by default — it never deletes or bans unless the caller opts in —
// so a false positive can't nuke a legit message. Two signals:
//   1. A known-dangerous wallet address pasted in the message (from wallet-labels).
//   2. A URL whose host matches a known drainer / phishing pattern.

// Seed list of wallet-drainer + fake-airdrop host patterns. Matched as substrings of
// the URL host so "claim.drainer.app" hits "drainer". Kept deliberately small and
// high-signal; expand via the scammer-category labels as the DB grows.
const DRAINER_HOST_PATTERNS = [
  'drainer',
  'wallet-connect',       // typosquat of walletconnect
  'walletconnect-',       // "walletconnect-verify.app" style
  'claim-',               // claim-sol.app, claim-airdrop.xyz
  '-airdrop',
  'airdrop-claim',
  'free-sol',
  'sol-claim',
  'verify-wallet',
  'phantom-connect',      // not the legit phantom.app
  'solana-airdrop',
];

const URL_RE = /https?:\/\/([^\s/]+)/gi;

export interface ScamFinding {
  reason: string;         // human-readable, shown in the warning
  evidence: string;       // the offending host or address
}

/** Inspect one group message; return a finding if it trips a guard, else null. */
export function inspectMessage(text: string): ScamFinding | null {
  // 1. Drainer / phishing URLs.
  for (const match of text.matchAll(URL_RE)) {
    const host = match[1].toLowerCase();
    const hit = DRAINER_HOST_PATTERNS.find((p) => host.includes(p));
    if (hit) return { reason: 'links to a suspected wallet-drainer / phishing site', evidence: host };
  }

  // 2. Known-dangerous wallet addresses (scammer-category labels).
  for (const token of text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []) {
    if (!isValidSolanaAddress(token)) continue;
    if (isDangerous(token)) {
      const label = getWalletLabel(token);
      return {
        reason: `references a flagged ${label?.category ?? 'scam'} wallet`,
        evidence: label?.name ?? token,
      };
    }
  }

  return null;
}
