// Known Solana wallet labels database
// Categories: CEX, VC, DEX, Influencer, Scammer, Protocol, Market Maker

export type WalletCategory =
  | 'cex'           // Centralized exchanges
  | 'vc'            // Venture capital / funds
  | 'dex'           // DEX routers/protocols
  | 'influencer'    // Known traders/influencers
  | 'scammer'       // Known scam wallets
  | 'protocol'      // Protocol treasuries
  | 'market-maker'  // Market makers
  | 'bridge'        // Cross-chain bridges
  | 'deployer';     // Prolific token deployers

export interface WalletLabel {
  address: string;
  name: string;
  category: WalletCategory;
  verified: boolean;      // Confirmed identity
  risk?: 'safe' | 'neutral' | 'suspicious' | 'dangerous';
  twitter?: string;
  notes?: string;
}

// Category display info
export const CATEGORY_INFO: Record<WalletCategory, { emoji: string; color: string; displayName: string }> = {
  'cex': { emoji: '🏦', color: '#3b82f6', displayName: 'Exchange' },
  'vc': { emoji: '💼', color: '#8b5cf6', displayName: 'VC/Fund' },
  'dex': { emoji: '🔄', color: '#06b6d4', displayName: 'DEX' },
  'influencer': { emoji: '⭐', color: '#eab308', displayName: 'Influencer' },
  'scammer': { emoji: '⚠️', color: '#ef4444', displayName: 'Scammer' },
  'protocol': { emoji: '🔷', color: '#6366f1', displayName: 'Protocol' },
  'market-maker': { emoji: '📊', color: '#14b8a6', displayName: 'Market Maker' },
  'bridge': { emoji: '🌉', color: '#f97316', displayName: 'Bridge' },
  'deployer': { emoji: '🚀', color: '#ec4899', displayName: 'Deployer' },
};

// Known wallet database
export const WALLET_LABELS: WalletLabel[] = [
  // ============ CENTRALIZED EXCHANGES ============
  // Binance
  { address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', name: 'Binance', category: 'cex', verified: true, risk: 'safe' },
  { address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', name: 'Binance 2', category: 'cex', verified: true, risk: 'safe' },
  { address: '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S', name: 'Binance 3', category: 'cex', verified: true, risk: 'safe' },
  { address: 'BqnpCdDLPV2pFdAaLnVidmn3G93RP2p5oRdGEY2sJGez', name: 'Binance Hot', category: 'cex', verified: true, risk: 'safe' },

  // Coinbase
  { address: 'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', name: 'Coinbase', category: 'cex', verified: true, risk: 'safe' },
  { address: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', name: 'Coinbase 2', category: 'cex', verified: true, risk: 'safe' },
  { address: '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm', name: 'Coinbase Prime', category: 'cex', verified: true, risk: 'safe' },

  // Kraken
  { address: 'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5', name: 'Kraken', category: 'cex', verified: true, risk: 'safe' },
  { address: 'CwE1VgjNoH5Xkx3VPH5MtXQ5GE1F4T7druUhHfvdkpXB', name: 'Kraken 2', category: 'cex', verified: true, risk: 'safe' },

  // OKX
  { address: '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD', name: 'OKX', category: 'cex', verified: true, risk: 'safe' },
  { address: 'AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS', name: 'OKX 2', category: 'cex', verified: true, risk: 'safe' },

  // Bybit
  { address: 'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2', name: 'Bybit', category: 'cex', verified: true, risk: 'safe' },

  // KuCoin
  { address: 'BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6', name: 'KuCoin', category: 'cex', verified: true, risk: 'safe' },

  // Gate.io
  { address: 'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w', name: 'Gate.io', category: 'cex', verified: true, risk: 'safe' },

  // Huobi/HTX
  { address: '88xTWZMeKfiTgbfEmPLdsUCQcZinwUfk25EBQZ21XMAZ', name: 'HTX (Huobi)', category: 'cex', verified: true, risk: 'safe' },

  // Bitget
  { address: '5jAx5Fv2xdSN5cRU4NMCv8KhXNnUJJDrz2CSQTkYkEhx', name: 'Bitget', category: 'cex', verified: true, risk: 'safe' },

  // MEXC
  { address: 'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ', name: 'MEXC', category: 'cex', verified: true, risk: 'safe' },

  // ============ DEX PROTOCOLS ============
  // Jupiter
  { address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', name: 'Jupiter Aggregator', category: 'dex', verified: true, risk: 'safe' },
  { address: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', name: 'Jupiter V4', category: 'dex', verified: true, risk: 'safe' },
  { address: 'jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu', name: 'Jupiter Limit', category: 'dex', verified: true, risk: 'safe' },

  // Raydium
  { address: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', name: 'Raydium AMM', category: 'dex', verified: true, risk: 'safe' },
  { address: '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h', name: 'Raydium Authority', category: 'dex', verified: true, risk: 'safe' },
  { address: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', name: 'Raydium CPMM', category: 'dex', verified: true, risk: 'safe' },

  // Orca
  { address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', name: 'Orca Whirlpool', category: 'dex', verified: true, risk: 'safe' },
  { address: '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP', name: 'Orca Token Swap', category: 'dex', verified: true, risk: 'safe' },

  // Pump.fun
  { address: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', name: 'Pump.fun', category: 'dex', verified: true, risk: 'neutral' },
  { address: 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1', name: 'Pump.fun Fee', category: 'dex', verified: true, risk: 'neutral' },

  // Meteora
  { address: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', name: 'Meteora DLMM', category: 'dex', verified: true, risk: 'safe' },
  { address: 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', name: 'Meteora Pools', category: 'dex', verified: true, risk: 'safe' },

  // ============ VENTURE CAPITAL / FUNDS ============
  { address: '9AhKqLR67hwapvG8SA2JFXaCshXc9nALJjpKaHZrsbkw', name: 'Alameda Research', category: 'vc', verified: true, risk: 'neutral', notes: 'Defunct - FTX collapse' },
  { address: '8ggviFegLUzsddm9ShyMy42TiDYyH9yDDS3gSGpj6Xmv', name: 'Jump Trading', category: 'vc', verified: true, risk: 'safe' },
  { address: 'CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkyErMqkRQq', name: 'Wintermute', category: 'market-maker', verified: true, risk: 'safe' },
  { address: 'DBnWKq1Ln9y8HtGwYxFMqMWLY1Ld9xpB28ayKfHejiTs', name: 'DWF Labs', category: 'vc', verified: true, risk: 'neutral', notes: 'Active MM, controversial' },
  { address: '3Kau4mJBnXScwFRNj9GchJgcnCZqjNqXsV2aL6tJPjRb', name: 'Multicoin Capital', category: 'vc', verified: true, risk: 'safe' },
  { address: 'CQrqDL4e3wnCXL1XxQ5ZB8vQrQo7bRxjY4XzGgqjGMvt', name: 'a16z Crypto', category: 'vc', verified: false, risk: 'safe' },
  { address: 'HzqZs7kgEPQKZyU2foBkJ7R7JzZgKwPJkKVTthRbfhJT', name: 'Paradigm', category: 'vc', verified: false, risk: 'safe' },

  // ============ BRIDGES ============
  { address: 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb', name: 'Wormhole Bridge', category: 'bridge', verified: true, risk: 'safe' },
  { address: 'eeLHBp7pdPKgKLscMYFZ4T92C6HL8NPPGJ3vvYbqp83', name: 'Portal Bridge', category: 'bridge', verified: true, risk: 'safe' },
  { address: 'H3kBM62KvEL8QjdJLZpJKwfZ8u4xSjKAoLM8GBDL6Lsg', name: 'Allbridge', category: 'bridge', verified: true, risk: 'safe' },
  { address: 'DDMwNk7jJASjLtCyxeF2pGS8GVdM5qXz3SqXPNhpM3a3', name: 'deBridge', category: 'bridge', verified: true, risk: 'safe' },

  // ============ PROTOCOLS ============
  { address: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD', name: 'Marinade Finance', category: 'protocol', verified: true, risk: 'safe' },
  { address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', name: 'Marinade Staking', category: 'protocol', verified: true, risk: 'safe' },
  { address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', name: 'Jito Staking', category: 'protocol', verified: true, risk: 'safe' },
  { address: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb', name: 'Jito Tips', category: 'protocol', verified: true, risk: 'safe' },
  { address: '4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg', name: 'Mango Markets', category: 'protocol', verified: true, risk: 'safe' },
  { address: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH', name: 'Drift Protocol', category: 'protocol', verified: true, risk: 'safe' },

  // ============ KNOWN SCAMMERS / RUG DEPLOYERS ============
  { address: 'ScAMmErWallet1111111111111111111111111111111', name: 'Example Scammer', category: 'scammer', verified: false, risk: 'dangerous', notes: 'Placeholder - add real scam wallets' },

  // ============ INFLUENCERS / KNOWN TRADERS ============
  { address: '5MMCR1P1gjHc6T1tMNWLxLPgQbHdCGrDhNdHDjAQ44u8', name: 'Ansem', category: 'influencer', verified: false, risk: 'neutral', twitter: '@blknoiz06' },

];

// Create a lookup map for fast access
const labelMap = new Map<string, WalletLabel>();
WALLET_LABELS.forEach(label => {
  labelMap.set(label.address, label);
});

// Get label for a wallet address
export function getWalletLabel(address: string): WalletLabel | null {
  return labelMap.get(address) || null;
}

// Get all labels for a list of addresses
export function getWalletLabels(addresses: string[]): Map<string, WalletLabel> {
  const result = new Map<string, WalletLabel>();
  addresses.forEach(addr => {
    const label = labelMap.get(addr);
    if (label) {
      result.set(addr, label);
    }
  });
  return result;
}

// Check if address is a known CEX
export function isCEX(address: string): boolean {
  const label = labelMap.get(address);
  return label?.category === 'cex';
}

// Check if address is a known DEX router
export function isDEX(address: string): boolean {
  const label = labelMap.get(address);
  return label?.category === 'dex';
}

// Check if address is flagged as dangerous
export function isDangerous(address: string): boolean {
  const label = labelMap.get(address);
  return label?.risk === 'dangerous';
}

// Get category stats from a list of addresses
export function getCategoryStats(addresses: string[]): Record<WalletCategory, number> {
  const stats: Record<WalletCategory, number> = {
    'cex': 0,
    'vc': 0,
    'dex': 0,
    'influencer': 0,
    'scammer': 0,
    'protocol': 0,
    'market-maker': 0,
    'bridge': 0,
    'deployer': 0,
  };

  addresses.forEach(addr => {
    const label = labelMap.get(addr);
    if (label) {
      stats[label.category]++;
    }
  });

  return stats;
}

// Count total labeled wallets
export function countLabeledWallets(addresses: string[]): number {
  return addresses.filter(addr => labelMap.has(addr)).length;
}
