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
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter v6
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',  // Jupiter v4
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
  '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', // Serum DEX
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',  // Pump.fun Program
  'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskCH9Cyk3Hid', // Pump.fun Fee
  '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg', // Pump.fun AMM
  'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp18V', // Pump.fun Bonding Curve Seed
  'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJ82mRY6884Z', // Pump.fun Migration
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',  // Meteora DLMM
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora Pools
  'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ',  // Raydium Swap
  'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',  // OpenBook
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
