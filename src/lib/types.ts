// Graph Node Types
export type NodeType = 'target' | 'funder' | 'funded' | 'connected' | 'holder' | 'token' | 'cabal-funder';

export interface GraphNode {
  id: string;                    // Wallet address
  label: string;                 // Truncated address
  val: number;                   // Node size (based on SOL amount)
  color: string;                 // Node color (role-based)
  type: NodeType;
  depth: number;                 // Distance from target
  solBalance?: number;
  tokenAmount?: number;          // For holder nodes
  expanded: boolean;
  metadata?: {
    firstTx?: number;            // Unix timestamp
    txCount?: number;
    fundedBy?: string[];
    funded?: string[];
    suspicious?: boolean;
    fundedCount?: number;        // For cabal-funder nodes
  };
}

export interface GraphLink {
  source: string;                // Funder wallet
  target: string;                // Funded wallet
  value: number;                 // SOL amount transferred
  timestamp?: number;
  txSignature?: string;
  suspicious?: boolean;          // Red highlight for cabal links
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// API Response Types
export interface TraceResponse {
  success: boolean;
  data?: GraphData;
  stats?: {
    nodesFound: number;
    linksFound: number;
    scanDepth: number;
  };
  error?: string;
}

export interface TokenResponse {
  success: boolean;
  data?: GraphData;
  stats?: {
    totalHolders: number;
    analyzedHolders: number;
    cabalConnectionsFound: number;
    suspiciousWallets: string[];
    dexFundedHolders?: number;
    freshWalletFunders?: number;
  };
  tokenSecurity?: TokenSecurityInfo | null;
  tokenMetadata?: TokenMetadata | null;
  error?: string;
}

export interface ExpandResponse {
  success: boolean;
  newNodes?: GraphNode[];
  newLinks?: GraphLink[];
  error?: string;
}

// Helius API Types
export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  slot: number;
  fee: number;
  feePayer: string;
  type: string;                    // Transaction type: TRANSFER, SWAP, TOKEN_MINT, etc.
  source: string;                  // Source app: SYSTEM_PROGRAM, JUPITER, RAYDIUM, etc.
  description?: string;            // Human-readable description
  accountData: HeliusAccountData[];
  nativeTransfers?: HeliusNativeTransfer[];
  tokenTransfers?: HeliusTokenTransfer[];
  events?: HeliusTransactionEvents;
}

// Enriched transaction events from Helius
export interface HeliusTransactionEvents {
  nft?: object;
  swap?: HeliusSwapEvent;
  compressed?: object;
}

export interface HeliusSwapEvent {
  nativeInput?: { account: string; amount: string };
  nativeOutput?: { account: string; amount: string };
  tokenInputs?: { userAccount: string; tokenAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[];
  tokenOutputs?: { userAccount: string; tokenAccount: string; mint: string; rawTokenAmount: { tokenAmount: string; decimals: number } }[];
  tokenFees?: object[];
  nativeFees?: object[];
  innerSwaps?: object[];
}

// Transaction type filter options
export type HeliusTransactionType =
  | 'TRANSFER'
  | 'SWAP'
  | 'TOKEN_MINT'
  | 'NFT_MINT'
  | 'COMPRESSED_NFT_MINT'
  | 'NFT_SALE'
  | 'NFT_LISTING'
  | 'NFT_BID'
  | 'BURN'
  | 'BURN_NFT'
  | 'STAKE_TOKEN'
  | 'UNSTAKE_TOKEN'
  | 'LOAN'
  | 'BORROW_FOX'
  | 'UNKNOWN';

export interface HeliusAccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges: HeliusTokenBalanceChange[];
}

export interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;  // In lamports
}

export interface HeliusTokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  mint: string;
  tokenAmount: number;
  tokenStandard: string;
}

export interface HeliusTokenBalanceChange {
  mint: string;
  rawTokenAmount: {
    tokenAmount: string;
    decimals: number;
  };
  tokenAccount: string;
  userAccount: string;
}

export interface TokenHolder {
  owner: string;
  amount: number;
  tokenAccount?: string;
}

// Funder extraction result
export interface FunderInfo {
  address: string;
  amount: number;       // In SOL
  timestamp: number;
  txSignature: string;
}

// Mode for the app
export type AppMode = 'wallet' | 'token';

// Color palette for Rico Maps - bubble/outline style
export const NODE_COLORS = {
  target: '#e34946',      // Coral red - target wallet
  funder: '#64b5f6',      // Soft blue - funders
  funded: '#ce93d8',      // Soft purple - funded wallets
  holder: '#5a7a9a',      // Muted blue-gray - token holders (floating bubbles)
  token: '#ffd54f',       // Gold - token center node
  'cabal-funder': '#ff3366',  // Hot pink - suspicious shared funder (with glow)
  connected: '#ff9f43',   // Orange - connected to cabal
  default: '#4a5a6a',     // Gray fallback
  unlinked: '#3a4a5a',    // Faded grey-blue - isolated nodes (background noise)
  hub: '#ffcc00',         // Yellow - high-centrality nodes
} as const;

export const LINK_COLORS = {
  normal: 'rgba(227, 73, 70, 0.2)',  // Semi-transparent coral
  suspicious: '#ff3366',  // Red for cabal links
} as const;

// DexScreener API Types
export interface DexScreenerBoostToken {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  openGraph?: string;
  description?: string;
  links?: {
    type: string;
    label: string;
    url: string;
  }[];
  totalAmount?: number;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
}

export interface EnrichedToken {
  address: string;
  name: string;
  symbol: string;
  icon: string;
  priceUsd: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  boostAmount?: number;
}

export interface TrendingResponse {
  success: boolean;
  trending: EnrichedToken[];
  featured: EnrichedToken[];
  error?: string;
}

export interface ScanResponse {
  success: boolean;
  mode?: AppMode;
  data?: GraphData;
  stats?: {
    nodesFound?: number;
    linksFound?: number;
    scanDepth?: number;
    totalHolders?: number;
    analyzedHolders?: number;
    cabalConnectionsFound?: number;
    suspiciousWallets?: string[];
    dexFundedHolders?: number;
    freshWalletFunders?: number;
  };
  tokenSecurity?: TokenSecurityInfo | null;
  tokenMetadata?: TokenMetadata | null;
  error?: string;
}

// Helius DAS API Types
export interface HeliusAsset {
  interface: string;
  id: string;
  content?: {
    $schema?: string;
    json_uri?: string;
    files?: { uri: string; type: string }[];
    metadata?: {
      name?: string;
      symbol?: string;
      description?: string;
    };
    links?: {
      image?: string;
      external_url?: string;
    };
  };
  authorities?: { address: string; scopes: string[] }[];
  compression?: {
    eligible: boolean;
    compressed: boolean;
  };
  grouping?: { group_key: string; group_value: string }[];
  royalty?: {
    royalty_model: string;
    target: string | null;
    percent: number;
    locked: boolean;
  };
  creators?: { address: string; share: number; verified: boolean }[];
  ownership?: {
    owner: string;
    delegate: string | null;
    delegated: boolean;
    ownership_model: string;
  };
  supply?: {
    print_max_supply: number;
    print_current_supply: number;
    edition_nonce: number | null;
  };
  mutable?: boolean;
  burnt?: boolean;
  token_info?: {
    symbol?: string;
    balance?: number;
    supply?: number;
    decimals?: number;
    token_program?: string;
    associated_token_address?: string;
    price_info?: {
      price_per_token?: number;
      total_price?: number;
      currency?: string;
    };
  };
}

// Token Security Analysis (derived from HeliusAsset)
export interface TokenSecurityInfo {
  hasFreezeAuthority: boolean;
  freezeAuthority?: string;
  hasMintAuthority: boolean;
  mintAuthority?: string;
  isMutable: boolean;
  supply?: number;
  decimals?: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskFactors: string[];
}

export interface TokenMetadata {
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
}

// Enriched funder info with transaction context
export interface EnrichedFunderInfo {
  address: string;
  amount: number;           // In SOL
  timestamp: number;
  txSignature: string;
  txType: string;           // TRANSFER, SWAP, etc.
  txSource: string;         // SYSTEM_PROGRAM, JUPITER, etc.
  description?: string;
  viaDex: boolean;          // True if funds came through a DEX
  viaMixer: boolean;        // True if funds came through known mixer
  walletAge?: number;       // Days since first transaction
  txCount?: number;         // Total transaction count
}

// Wallet forensic profile
export interface WalletProfile {
  address: string;
  firstTxTimestamp?: number;
  lastTxTimestamp?: number;
  totalTxCount: number;
  walletAgeDays: number;
  isFreshWallet: boolean;   // Less than 7 days old
  totalSolReceived: number;
  totalSolSent: number;
  uniqueInteractions: number;
  dexActivity: boolean;
  suspiciousPatterns: string[];
}

// Streaming/Real-time Types
export interface StreamingTransaction {
  signature: string;
  timestamp: number;
  fromAddress: string;
  toAddress: string;
  amount: number; // In SOL
  type: 'native' | 'token';
  mint?: string;
}

export interface GraphUpdate {
  newNodes: GraphNode[];
  newLinks: GraphLink[];
  updatedNodes?: Partial<GraphNode>[];
}

export interface StreamingState {
  isStreaming: boolean;
  watchedAddresses: string[];
  lastUpdate: number | null;
  transactionCount: number;
}
