// Graph Node Types
export type NodeType = 'target' | 'funder' | 'funded' | 'connected' | 'holder' | 'token' | 'cabal-funder' | 'sniper' | 'bundled' | 'pool';

export interface GraphNode {
  id: string;                    // Wallet address
  label: string;                 // Truncated address or identity name
  val: number;                   // Node size (based on SOL amount)
  color: string;                 // Node color (role-based)
  type: NodeType;
  depth: number;                 // Distance from target
  solBalance?: number;
  tokenAmount?: number;          // For holder nodes
  expanded: boolean;

  // Helius Wallet API identity
  identity?: {
    name: string | null;
    category: string | null;     // "Centralized Exchange", "DeFi Protocol", etc.
    type: string | null;         // "exchange", "defi", "market-maker", "validator"
    tags: string[];
  };

  // Replaces simple walletLabel
  walletLabel?: {
    name: string;
    category: string;
    verified: boolean;
    risk?: string;
  };

  // Wallet portfolio snapshot (from /balances API)
  portfolio?: {
    totalUsdValue: number;
    solBalance: number;
    tokenCount: number;
    topHoldings: { symbol: string; usdValue: number; balance: number }[];
  };

  // Funding chain data
  fundingSource?: {
    funderAddress: string;
    funderName: string | null;    // From Wallet API identity
    funderType: string | null;    // "exchange", "defi", etc.
    amount: number;               // SOL amount
    timestamp: number;
    signature: string;
  };

  metadata?: {
    firstTx?: number;            // Unix timestamp
    txCount?: number;
    fundedBy?: string[];
    funded?: string[];
    suspicious?: boolean;
    fundedCount?: number;        // For cabal-funder nodes
    isSniper?: boolean;          // Bought in first blocks
    buyBlock?: number;
    buyTimestamp?: number;
    blocksAfterLaunch?: number;
    // Deep forensic data
    walletAgeDays?: number;
    totalTransfers?: number;     // Total in+out transfer count
    sharedFunderGroup?: string;  // ID of the funder cluster this wallet belongs to
    behavioralCluster?: string;  // ID of the behavior-based cluster (funding-independent)
    cabalConfidence?: number;    // 0-100 confidence score
    isBundled?: boolean;         // Detected in Jito bundle cluster
    isPool?: boolean;            // Liquidity pool / AMM / treasury, not a real holder
    threatScore?: number;        // Composite threat score 0-100
    threatLevel?: 'critical' | 'high' | 'medium' | 'low' | 'safe';
    transferPatterns?: {
      totalIn: number;           // Total SOL received
      totalOut: number;          // Total SOL sent
      uniqueCounterparties: number;
    };
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

// Supply-held concentration metrics (all % are share of circulating supply, NOT volume)
export interface SupplyConcentration {
  bundledSupplyPct: number;          // Supply held by bundled wallets
  sniperSupplyPct: number;           // Supply held by snipers
  cabalSupplyPct: number;            // Supply held by shared-funder cluster members
  insiderStillHoldingPct: number;    // Current supply held by bundled ∪ sniper wallets
  top10Pct: number;                  // Supply held by top 10 real holders
  top25Pct: number;                  // Supply held by top 25 real holders
  giniCoefficient: number;           // 0 (even) → 1 (fully concentrated)
  freshWalletPct: number;            // % of real holders funded < 7d ago (proxy)
  realHolderCount: number;           // Analyzed holders excluding pools
  poolSupplyPct: number;             // Supply parked in pool/AMM/treasury wallets
  analyzedSupplyPct: number;         // Coverage: % of supply the analyzed holders represent
  circulatingSupplyUsed: number;     // Denominator used (UI units)
  supplyDenominatorSource: 'mint' | 'sum'; // 'mint' = on-chain supply, 'sum' = holder fallback
}

// Token-level rug verdict: the fast entry signal
export interface RugFactor {
  label: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  points: number;
}

export interface RugScore {
  score: number;                       // 0-100, higher = riskier
  level: 'green' | 'yellow' | 'red';   // traffic light
  confidence: 'high' | 'medium' | 'low'; // driven by holder-coverage, NOT the score
  factors: RugFactor[];                // sorted desc by points; UI shows top 3
  coverageNote?: string;               // shown when confidence !== 'high'
}

//  Deployer / dev intel: the single biggest rug predictor
export interface DeployerInfo {
  address: string;
  source: 'mint-tx-signer' | 'creator' | 'update-authority';
  stillHolds: boolean | null;   // null = outside analyzed coverage (unknown, not "dumped")
  heldSupplyPct: number | null; // % of circulating supply, if found in holder set
  inAnalyzedSet: boolean;       // whether deployer was within the analyzed top-N
  pastLaunchCount: number | null; // tokens created by this address (null = lookup skipped/failed)
  isSerialDeployer: boolean;
  fundedBy: { address: string; amount: number; source: string } | null;
  notes: string[];              // attribution + coverage caveats
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
    totalHolders: number;         // After filtering known programs
    rawHolderCount: number;       // Raw from API
    filteredOut: number;          // How many filtered
    analyzedHolders: number;
    analysisIncomplete: boolean;  // Did analysis stop early?
    cabalConnectionsFound: number;
    suspiciousWallets: string[];
    dexFundedHolders?: number;
    freshWalletFunders?: number;
    snipersDetected?: number;
    sniperWallets?: string[];
    bundleClustersDetected?: number;
    bundledWallets?: string[];
    behavioralClustersDetected?: number;
    behaviorallyClusteredWallets?: string[];
    supplyConcentration?: SupplyConcentration;
    rugScore?: RugScore;
    cabalFingerprint?: CabalFingerprintResult;
  };
  tokenSecurity?: TokenSecurityInfo | null;
  tokenMetadata?: TokenMetadata | null;
  deployerInfo?: DeployerInfo | null;
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

// Color palette: Matrix green forensic theme
export const NODE_COLORS = {
  target: '#00FF41',       // Matrix green: target wallet
  funder: '#64b5f6',       // Blue: funders
  funded: '#8b8bff',       // Soft purple: funded wallets
  holder: '#1a7a3a',       // Dim green: token holders
  token: '#f59e0b',        // Amber: token center node
  'cabal-funder': '#ff3366',  // Hot pink: suspicious shared funder
  connected: '#ff9f43',    // Orange: connected to cabal
  sniper: '#00ffcc',       // Cyan: sniped early (bought in first blocks)
  bundled: '#a78bfa',      // Purple: detected in Jito bundle cluster
  pool: '#9ca3af',         // Gray: liquidity pool / AMM (infrastructure, not a real holder)
  default: '#2a3a2a',      // Dark green-gray fallback
  unlinked: '#1a2a1a',     // Faded dark: isolated nodes
  hub: '#ffcc00',          // Yellow: high-centrality nodes
} as const;

export const LINK_COLORS = {
  normal: 'rgba(0, 255, 65, 0.15)',  // Semi-transparent matrix green
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
    totalHolders?: number;         // After filtering known programs
    rawHolderCount?: number;       // Raw from API
    filteredOut?: number;          // How many filtered (exchanges, programs)
    analyzedHolders?: number;
    analysisIncomplete?: boolean;  // Did analysis stop early due to API limits?
    cabalConnectionsFound?: number;
    suspiciousWallets?: string[];
    dexFundedHolders?: number;
    freshWalletFunders?: number;
    snipersDetected?: number;      // Number of wallets that bought in first blocks
    sniperWallets?: string[];      // Addresses of snipers
    bundleClustersDetected?: number;
    bundledWallets?: string[];
    behavioralClustersDetected?: number;
    behaviorallyClusteredWallets?: string[];
    supplyConcentration?: SupplyConcentration;
    rugScore?: RugScore;
    cabalFingerprint?: CabalFingerprintResult;
  };
  tokenSecurity?: TokenSecurityInfo | null;
  tokenMetadata?: TokenMetadata | null;
  deployerInfo?: DeployerInfo | null;
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
  // Social links
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  // Market data (DexScreener)
  priceUsd?: number;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  liquidity?: number;
  fdv?: number;
  dexUrl?: string;
  pairAddress?: string;
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

// A single owner's live token balance change for a watched mint, pushed by the
// LaserStream worker over SSE. `delta < 0` is a sell; `newBalance === 0` is a close.
export interface HolderDelta {
  owner: string;
  newBalance: number;
  delta: number;
  slot: number;
  signature: string;
}

// Bundle Detection / Blacklist Types

export interface BundleTokenAppearance {
  mint: string;
  tokenName?: string;
  tokenSymbol?: string;
  slot: number;
  timestamp: number;
  walletCount: number;
  transactionSignatures: string[];
}

export interface BundleCluster {
  id: string;
  wallets: string[];
  tokens: BundleTokenAppearance[];
  totalAppearances: number;
  lastSeenTimestamp: number;
  firstSeenTimestamp: number;
  confidence: number;
  sharedFunder?: string;
  metadata?: {
    avgClusterSize: number;
    maxSameSlotCount: number;
  };
}

// Persistent Cabal Identity: fingerprint keyed on funding source + topology so a
// crew is recognized across tokens even after they rotate their buy wallets.
export interface CabalFingerprintComponents {
  funderAddresses: string[];        // sorted, deduped shared-funder deposit addresses
  funderCategory: string | null;    // coarse source class: 'exchange' | 'bridge' | 'mixer' | 'laundered' | 'unknown'
  fanoutDepth: number;              // distinct funder→holder hop layers observed
  branchingBucket: string;          // bucketed fan-out width: '2-3' | '4-6' | '7-12' | '13+'
  walletAgeBucket: string;          // creation-cadence bucket: 'fresh' | 'mixed' | 'aged'
}

export interface CabalTokenHistory {
  mint: string;
  tokenName?: string;
  tokenSymbol?: string;
  firstSeen: number;                // unix seconds
  walletCount: number;
  rugLevel?: 'green' | 'yellow' | 'red'; // outcome signal from rugScore.level
  cabalSupplyPct?: number;          // from supplyConcentration.cabalSupplyPct
}

export interface CabalFingerprint {
  id: string;                       // sha256(components) sliced 16: STABLE across wallet rotation
  components: CabalFingerprintComponents;
  tokens: CabalTokenHistory[];
  totalAppearances: number;
  confidence: number;               // 0-100
  firstSeen: number;
  lastSeen: number;
  knownWallets: string[];           // union of wallets ever seen (cross-reference only, NOT keyed on)
  metadata?: { avgBranching?: number; reusedFunder?: boolean };
}

// Surfaced in scan responses: the current cabal's id + any prior crews it matches.
export interface CabalFingerprintResult {
  id: string;
  matches: CabalFingerprint[];
}

export interface BlacklistEntry {
  wallet: string;
  clusters: string[];
  tokenAppearances: number;
  lastSeen: number;
  confidence: number;
  solBalance?: number;
  identity?: { name: string | null; category: string | null };
}

export interface BlacklistResponse {
  success: boolean;
  clusters: BundleCluster[];
  totalWallets: number;
  totalClusters: number;
  page: number;
  totalPages: number;
  error?: string;
}

// ============================================================================
// ATLAS: the global cabal map (ecosystem-wide, not per-token)
// ============================================================================

export type AtlasTokenStatus = 'watching' | 'scanned' | 'alive' | 'rugged' | 'dead';

export interface AtlasToken {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string;          // token logo from metadata: rendered on the map node
  status: AtlasTokenStatus;
  createdAt: number;          // unix seconds: pump.fun create (or first seen)
  graduatedAt?: number;
  scannedAt?: number;
  lastCheckedAt?: number;
  liquidityUsd?: number;
  peakLiquidityUsd?: number;  // high-water mark; extraction estimates measure the fall from here
  marketCapUsd?: number;
  rugLevel?: 'green' | 'yellow' | 'red';
  cabalSupplyPct?: number;
  estExtractedUsd?: number;
}

export interface AtlasStats {
  cabalsTracked: number;
  cabalsActive24h: number;
  tokensTracked: number;
  rugs24h: number;
  totalExtractedUsd: number;
}

export interface AtlasCabalNode {
  id: string;
  confidence: number;
  tokenCount: number;
  walletCount: number;
  funderCategory: string;
  lastSeen: number;
  ruggedCount: number;
  estExtractedUsd: number;
}

export interface AtlasGraph {
  cabals: AtlasCabalNode[];
  tokens: AtlasToken[];
  edges: { cabalId: string; mint: string; supplyPct?: number }[];
  stats: AtlasStats;
}

// On-demand cabal intel (drill-down): live bags + SOL-flow PnL.
export interface CabalPosition {
  mint: string;
  symbol: string;
  name: string;
  usdValue: number;
  holderCount: number;
  logoUri?: string;
}

export interface CabalWalletPnl {
  address: string;
  realizedSol: number;
  portfolioUsd: number;
}

export interface CabalIntel {
  id: string;
  walletsAnalyzed: number;
  walletsTotal: number;
  totalPortfolioUsd: number;
  netRealizedSol: number;
  positions: CabalPosition[];
  topWallets: CabalWalletPnl[];
}

// Live frames from the worker's /stream/atlas SSE feed.
export interface AtlasSpawnEvent { mint: string; name?: string; symbol?: string; slot: number; signature: string; ts: number }
export interface AtlasGraduationEvent { mint: string; name?: string; symbol?: string; slot: number; signature: string; ts: number }
export interface AtlasCabalActivityEvent { mint: string; symbol?: string; ts: number; rugLevel?: string; fingerprintMatches: number; cabalSupplyPct?: number }
export interface AtlasRugEvent { mint: string; symbol?: string; estExtractedUsd: number; ts: number }
export interface AtlasCabalBuyEvent { cabalId: string; mint: string; wallet: string; symbol?: string; amountUsd?: number; ts: number }
