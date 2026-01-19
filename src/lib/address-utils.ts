import { PublicKey } from '@solana/web3.js';

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return address.length >= 32 && address.length <= 44;
  } catch {
    return false;
  }
}

export function truncateAddress(address: string, chars: number = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Known exchange and program addresses to filter out
const KNOWN_PROGRAMS = new Set([
  '11111111111111111111111111111111',  // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',  // Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
  'ComputeBudget111111111111111111111111111111',  // Compute Budget
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
  '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', // Serum DEX
]);

const KNOWN_EXCHANGES = new Set<string>([
  // Add known exchange hot wallets here
  // These can be expanded over time
]);

export function isKnownProgram(address: string): boolean {
  return KNOWN_PROGRAMS.has(address);
}

export function isKnownExchange(address: string): boolean {
  return KNOWN_EXCHANGES.has(address);
}

export function shouldFilterAddress(address: string): boolean {
  return isKnownProgram(address) || isKnownExchange(address);
}
