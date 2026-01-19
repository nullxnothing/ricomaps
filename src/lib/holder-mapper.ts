import { getAllTokenHolders, getFirstFunders, getTokenSecurity, getAsset } from './helius';
import { GraphNode, GraphLink, GraphData, NODE_COLORS, TokenHolder, TokenSecurityInfo, TokenMetadata, EnrichedFunderInfo } from './types';
import { truncateAddress, shouldFilterAddress } from './address-utils';

interface MapOptions {
  topN?: number;           // Number of top holders to analyze
  fundersPerHolder?: number;  // Number of funders to trace per holder
}

const DEFAULT_OPTIONS: MapOptions = {
  topN: 15,  // Minimal to conserve API calls
  fundersPerHolder: 1,  // Just first funder - enough to detect basic cabals
};

function createNode(
  address: string,
  depth: number,
  type: GraphNode['type'],
  amount?: number,
  metadata?: GraphNode['metadata']
): GraphNode {
  return {
    id: address,
    label: truncateAddress(address),
    val: Math.max(5, Math.log10((amount || 1) + 1) * 10),
    color: NODE_COLORS[type] || NODE_COLORS.default,
    type,
    depth,
    tokenAmount: type === 'holder' || type === 'token' ? amount : undefined,
    solBalance: type !== 'holder' && type !== 'token' ? amount : undefined,
    expanded: false,
    metadata,
  };
}

function createLink(
  source: string,
  target: string,
  amount: number,
  txSignature?: string,
  options?: { suspicious?: boolean }
): GraphLink {
  return {
    source,
    target,
    value: amount,
    txSignature,
    suspicious: options?.suspicious,
  };
}

export async function mapTokenHolders(
  mintAddress: string,
  options: MapOptions = {}
): Promise<{
  data: GraphData;
  stats: {
    totalHolders: number;
    analyzedHolders: number;
    cabalConnectionsFound: number;
    suspiciousWallets: string[];
    dexFundedHolders: number;
    freshWalletFunders: number;
  };
  tokenSecurity: TokenSecurityInfo | null;
  tokenMetadata: TokenMetadata | null;
}> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // Step 0: Get token security info and metadata
  console.log('Fetching token security info and metadata...');
  const [tokenSecurity, asset] = await Promise.all([
    getTokenSecurity(mintAddress),
    getAsset(mintAddress),
  ]);

  // Extract token metadata
  const tokenMetadata: TokenMetadata | null = asset ? {
    name: asset.content?.metadata?.name,
    symbol: asset.content?.metadata?.symbol,
    image: asset.content?.links?.image || asset.content?.files?.[0]?.uri,
    description: asset.content?.metadata?.description,
  } : null;

  if (tokenMetadata) {
    console.log(`Token: ${tokenMetadata.name} (${tokenMetadata.symbol})`);
  }

  if (tokenSecurity) {
    console.log(`Token risk level: ${tokenSecurity.riskLevel}`);
    if (tokenSecurity.riskFactors.length > 0) {
      console.log('Risk factors:', tokenSecurity.riskFactors);
    }
  }

  // Step 1: Get all token holders via Helius
  console.log('Fetching token holders...');
  const allHolders = await getAllTokenHolders(mintAddress);
  console.log(`Found ${allHolders.length} total holders`);

  // Step 2: Sort by amount, take top N holders
  const topHolders = allHolders
    .filter(h => h.amount > 0 && !shouldFilterAddress(h.owner))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, opts.topN || 50);

  console.log(`Analyzing top ${topHolders.length} holders`);

  // Step 3: Create token center node
  const tokenNode = createNode(mintAddress, 0, 'token', allHolders.reduce((sum, h) => sum + h.amount, 0));
  nodes.push(tokenNode);

  // Step 4: Create holder nodes (floating - no links to token center)
  // In the visual style, holders float freely unless they have cabal connections
  for (const holder of topHolders) {
    const holderNode = createNode(holder.owner, 1, 'holder', holder.amount);
    nodes.push(holderNode);
    // NO link to token center - holders will float freely
    // Links are only created for cabal connections below
  }

  // Step 5: Trace funding for each holder & find connections
  const funderMap = new Map<string, string[]>();  // funder -> [holders funded]
  const funderAmounts = new Map<string, number>(); // funder -> total amount funded
  const funderInfo = new Map<string, EnrichedFunderInfo>(); // Store enriched funder data
  let dexFundedHolders = 0;
  const dexFundedSet = new Set<string>();

  console.log('Tracing funding chains for holders...');

  // Smaller batches with longer delays to handle rate limits under load
  const batchSize = 5;
  for (let i = 0; i < topHolders.length; i += batchSize) {
    const batch = topHolders.slice(i, i + batchSize);

    const batchPromises = batch.map(async (holder) => {
      try {
        const funders = await getFirstFunders(holder.owner, opts.fundersPerHolder || 2);
        return { holder, funders };
      } catch (error) {
        console.error(`Error getting funders for ${holder.owner}:`, error);
        return { holder, funders: [] as EnrichedFunderInfo[] };
      }
    });

    const results = await Promise.all(batchPromises);

    for (const { holder, funders } of results) {
      // Track if this holder was funded via DEX (potential obfuscation)
      const hasDexFunding = funders.some(f => f.viaDex);
      if (hasDexFunding && !dexFundedSet.has(holder.owner)) {
        dexFundedSet.add(holder.owner);
        dexFundedHolders++;
      }

      for (const funder of funders) {
        if (shouldFilterAddress(funder.address)) continue;

        if (!funderMap.has(funder.address)) {
          funderMap.set(funder.address, []);
          funderAmounts.set(funder.address, 0);
          funderInfo.set(funder.address, funder);
        }
        funderMap.get(funder.address)!.push(holder.owner);
        funderAmounts.set(
          funder.address,
          (funderAmounts.get(funder.address) || 0) + funder.amount
        );
      }
    }

    // Longer delay between batches to respect rate limits
    if (i + batchSize < topHolders.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Step 6: Identify CABAL connections (funder funded multiple holders)
  const suspiciousWallets: string[] = [];
  const cabalConnectedHolders = new Set<string>(); // Track holders connected to cabal
  const existingNodeIds = new Set(nodes.map(n => n.id)); // Track existing node IDs to avoid duplicates
  let cabalConnectionsFound = 0;
  let freshWalletFunders = 0;

  for (const [funder, fundedHolders] of funderMap) {
    if (fundedHolders.length > 1) {
      // CABAL DETECTED!
      suspiciousWallets.push(funder);
      cabalConnectionsFound += fundedHolders.length;

      // Get enriched info for this funder
      const enrichedInfo = funderInfo.get(funder);
      const viaDex = enrichedInfo?.viaDex || false;
      const viaMixer = enrichedInfo?.viaMixer || false;

      // Track fresh wallet funders (additional red flag)
      if (enrichedInfo?.walletAge !== undefined && enrichedInfo.walletAge < 7) {
        freshWalletFunders++;
      }

      // Check if this funder is already a node (could be a holder who is also a funder)
      if (existingNodeIds.has(funder)) {
        // Update existing node to mark as cabal-funder
        const existingNodeIndex = nodes.findIndex(n => n.id === funder);
        if (existingNodeIndex !== -1) {
          nodes[existingNodeIndex] = {
            ...nodes[existingNodeIndex],
            type: 'cabal-funder',
            color: NODE_COLORS['cabal-funder'],
            metadata: {
              ...nodes[existingNodeIndex].metadata,
              suspicious: true,
              fundedCount: fundedHolders.length,
              firstTx: enrichedInfo?.timestamp,
              ...(viaDex && { fundedBy: ['DEX_FUNDED'] }),
              ...(viaMixer && { funded: ['MIXER_USED'] }),
            }
          };
        }
      } else {
        // Add new funder node with enriched suspicious metadata
        const funderNode = createNode(
          funder,
          2,
          'cabal-funder',
          funderAmounts.get(funder) || 0,
          {
            suspicious: true,
            fundedCount: fundedHolders.length,
            // Store forensic data in metadata for UI display
            firstTx: enrichedInfo?.timestamp,
          }
        );

        // Add forensic flags to node label/metadata for enhanced visualization
        if (viaDex) {
          funderNode.metadata = { ...funderNode.metadata, fundedBy: ['DEX_FUNDED'] };
        }
        if (viaMixer) {
          funderNode.metadata = { ...funderNode.metadata, funded: ['MIXER_USED'] };
        }

        nodes.push(funderNode);
        existingNodeIds.add(funder);
      }

      // Link funder to all holders they funded
      for (const holder of fundedHolders) {
        links.push(createLink(funder, holder, 0, undefined, { suspicious: true }));
        cabalConnectedHolders.add(holder);
      }
    }
  }

  // Step 7: Update holder nodes that are connected to cabal funders
  // Change their type to 'connected' for different styling
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type === 'holder' && cabalConnectedHolders.has(nodes[i].id)) {
      nodes[i] = {
        ...nodes[i],
        type: 'connected',
        color: NODE_COLORS.connected,
        metadata: {
          ...nodes[i].metadata,
          suspicious: true,
        }
      };
    }
  }

  console.log(`Found ${suspiciousWallets.length} suspicious funders with ${cabalConnectionsFound} cabal connections`);
  if (dexFundedHolders > 0) {
    console.log(`${dexFundedHolders} holders were funded via DEX (potential obfuscation)`);
  }
  if (freshWalletFunders > 0) {
    console.log(`${freshWalletFunders} cabal funders are fresh wallets (< 7 days old)`);
  }

  return {
    data: { nodes, links },
    stats: {
      totalHolders: allHolders.length,
      analyzedHolders: topHolders.length,
      cabalConnectionsFound,
      suspiciousWallets,
      dexFundedHolders,
      freshWalletFunders,
    },
    tokenSecurity,
    tokenMetadata,
  };
}
