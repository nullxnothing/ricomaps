import { getAllTokenHolders, getTokenSecurity, getAsset, getTokenLaunchInfo, getWalletFundedBy, batchIdentifyWallets, batchGetEarlyTransactions, checkSniperFromTransactions } from './helius';
import { GraphNode, GraphLink, GraphData, NODE_COLORS, TokenSecurityInfo, TokenMetadata, EnrichedFunderInfo } from './types';
import { truncateAddress, shouldFilterAddress } from './address-utils';
import { getWalletLabel } from './wallet-labels';
import { detectBundleClusters } from './bundle-detector';

const SNIPER_BLOCK_THRESHOLD = 10;
const SNIPER_SECONDS_THRESHOLD = 60;

interface MapOptions {
  topN?: number;
  fundersPerHolder?: number;
}

const DEFAULT_OPTIONS: MapOptions = { topN: 20, fundersPerHolder: 1 };

function createNode(address: string, depth: number, type: GraphNode['type'], amount?: number, metadata?: GraphNode['metadata']): GraphNode {
  const label = getWalletLabel(address);
  const walletLabel = label ? { name: label.name, category: label.category, verified: label.verified, risk: label.risk } : undefined;
  return {
    id: address,
    label: label ? label.name : truncateAddress(address),
    val: Math.max(5, Math.log10((amount || 1) + 1) * 10),
    color: NODE_COLORS[type] || NODE_COLORS.default,
    type, depth,
    tokenAmount: type === 'holder' || type === 'token' ? amount : undefined,
    solBalance: type !== 'holder' && type !== 'token' ? amount : undefined,
    expanded: false, walletLabel, metadata,
  };
}

function createLink(source: string, target: string, amount: number, txSig?: string, opts?: { suspicious?: boolean }): GraphLink {
  return { source, target, value: amount, txSignature: txSig, suspicious: opts?.suspicious };
}

/** Extract first SOL funder from transfer data (replaces funded-by API) */
export async function mapTokenHolders(mintAddress: string, options: MapOptions = {}): Promise<{
  data: GraphData;
  stats: {
    totalHolders: number; rawHolderCount: number; filteredOut: number;
    analyzedHolders: number; analysisIncomplete: boolean;
    cabalConnectionsFound: number; suspiciousWallets: string[];
    dexFundedHolders: number; freshWalletFunders: number;
    snipersDetected: number; sniperWallets: string[];
    bundleClustersDetected: number; bundledWallets: string[];
  };
  tokenSecurity: TokenSecurityInfo | null;
  tokenMetadata: TokenMetadata | null;
}> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // ═══════════════════════════════════════════════════════════
  // PHASE 1: All initial data in parallel (dedicated RPC — free, ~50ms)
  // ═══════════════════════════════════════════════════════════
  console.time('phase1');
  const [tokenSecurity, asset, allHolders, launchInfo] = await Promise.all([
    getTokenSecurity(mintAddress),
    getAsset(mintAddress),
    getAllTokenHolders(mintAddress, 1),
    getTokenLaunchInfo(mintAddress),
  ]);
  console.timeEnd('phase1');

  const tokenMetadata: TokenMetadata | null = asset ? {
    name: asset.content?.metadata?.name,
    symbol: asset.content?.metadata?.symbol,
    image: asset.content?.links?.image || asset.content?.files?.[0]?.uri,
    description: asset.content?.metadata?.description,
  } : null;

  const filteredHolders = allHolders.filter(h => h.amount > 0 && !shouldFilterAddress(h.owner));
  const filteredOutCount = allHolders.length - filteredHolders.length;
  const topHolders = filteredHolders.sort((a, b) => b.amount - a.amount).slice(0, opts.topN || 30);
  const holderSet = new Set(topHolders.map(h => h.owner));
  const holderAddresses = topHolders.map(h => h.owner);

  nodes.push(createNode(mintAddress, 0, 'token', allHolders.reduce((sum, h) => sum + h.amount, 0)));

  // ═══════════════════════════════════════════════════════════
  // PHASE 2: ALL parallel — funded-by + identities + early txs
  // Business+ tier: all fire simultaneously, no rate limit concern
  // ═══════════════════════════════════════════════════════════
  console.time('phase2');

  const [fundedByResults, identities, holderEarlyTxs] = await Promise.all([
    // Wallet API /funded-by for each holder (1 REST call each, parallel)
    Promise.all(topHolders.map(async (h) => {
      try {
        const funder = await getWalletFundedBy(h.owner);
        return { owner: h.owner, funder };
      } catch { return { owner: h.owner, funder: null }; }
    })),
    // 1 batch identity call
    batchIdentifyWallets(holderAddresses),
    // Early txs for sniper + bundle detection (Enhanced API, parallel)
    batchGetEarlyTransactions(holderAddresses, 10),
  ]);

  console.timeEnd('phase2');

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: Process results — funder connections, snipers, bundles
  // (zero API calls, pure CPU except funder identity batch)
  // ═══════════════════════════════════════════════════════════
  console.time('phase3');

  const funderMap = new Map<string, string[]>();
  const funderAmounts = new Map<string, number>();
  const funderInfo = new Map<string, EnrichedFunderInfo>();

  function addLink(funderAddr: string, holderAddr: string, amount: number, info?: EnrichedFunderInfo) {
    if (shouldFilterAddress(funderAddr) || funderAddr === holderAddr) return;
    if (!funderMap.has(funderAddr)) {
      funderMap.set(funderAddr, []);
      funderAmounts.set(funderAddr, 0);
      if (info) funderInfo.set(funderAddr, info);
    }
    if (!funderMap.get(funderAddr)!.includes(holderAddr)) {
      funderMap.get(funderAddr)!.push(holderAddr);
      funderAmounts.set(funderAddr, (funderAmounts.get(funderAddr) || 0) + amount);
    }
  }

  // Build funder connections from funded-by results
  for (const { owner, funder } of fundedByResults) {
    if (!funder) continue;
    addLink(funder.address, owner, funder.amount, funder);

    // Also detect: holder's funder IS another holder (direct circle)
    if (holderSet.has(funder.address)) {
      addLink(funder.address, owner, funder.amount, funder);
    }
  }

  // ── Sniper detection (uses already-fetched launchInfo + early txs) ──
  const sniperWallets: string[] = [];
  const sniperBuyInfo = new Map<string, { blocksAfterLaunch: number; secondsAfterLaunch: number }>();

  if (launchInfo && launchInfo.mintTimestamp > 0) {
    for (const holder of topHolders) {
      const earlyTxs = holderEarlyTxs.get(holder.owner);
      if (!earlyTxs || earlyTxs.length === 0) continue;

      const buyInfo = checkSniperFromTransactions(
        earlyTxs, holder.owner, mintAddress,
        launchInfo.mintSlot, launchInfo.mintTimestamp
      );

      if (buyInfo &&
        buyInfo.blocksAfterLaunch <= SNIPER_BLOCK_THRESHOLD &&
        buyInfo.secondsAfterLaunch <= SNIPER_SECONDS_THRESHOLD
      ) {
        sniperWallets.push(holder.owner);
        sniperBuyInfo.set(holder.owner, {
          blocksAfterLaunch: buyInfo.blocksAfterLaunch,
          secondsAfterLaunch: buyInfo.secondsAfterLaunch,
        });
      }
    }
    if (sniperWallets.length > 0) {
      console.log(`Detected ${sniperWallets.length} snipers (within ${SNIPER_BLOCK_THRESHOLD} blocks)`);
    }
  }

  // ── Bundle detection (uses already-fetched early txs, zero API calls) ──
  const bundleClusters = detectBundleClusters(holderEarlyTxs, {
    mintAddress,
    tokenName: tokenMetadata?.name,
    tokenSymbol: tokenMetadata?.symbol,
    funderMap,
  });

  const bundledWalletSet = new Set<string>();
  for (const cluster of bundleClusters) {
    for (const wallet of cluster.wallets) {
      bundledWalletSet.add(wallet);
    }
  }
  if (bundleClusters.length > 0) {
    console.log(`Detected ${bundleClusters.length} bundle clusters (${bundledWalletSet.size} wallets)`);
  }

  // Batch identify funder wallets (1 keyed API call)
  const funderAddresses = Array.from(funderMap.keys()).filter(a => !holderSet.has(a));
  const funderIdentities = funderAddresses.length > 0 ? await batchIdentifyWallets(funderAddresses) : new Map();

  console.timeEnd('phase3');

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: Build graph — ALL connections (zero API calls)
  // ═══════════════════════════════════════════════════════════

  const sniperSet = new Set(sniperWallets);
  const existingNodeIds = new Set(nodes.map(n => n.id));
  const linkSet = new Set<string>(); // Dedupe links

  // 4-pre: Detect LP/bonding curve/pool addresses — any address that interacts
  // with a large % of holders is a pool, not a real wallet connection
  const counterpartyCount = new Map<string, number>();
  for (const [holderAddr, txs] of holderEarlyTxs) {
    if (!holderSet.has(holderAddr)) continue;
    const seenCounterparties = new Set<string>();
    for (const tx of txs) {
      if (tx.nativeTransfers) {
        for (const t of tx.nativeTransfers) {
          const other = t.fromUserAccount === holderAddr ? t.toUserAccount : t.fromUserAccount;
          if (other && other !== holderAddr) seenCounterparties.add(other);
        }
      }
      if (tx.tokenTransfers) {
        for (const t of tx.tokenTransfers) {
          const other = t.fromUserAccount === holderAddr ? t.toUserAccount : t.fromUserAccount;
          if (other && other !== holderAddr) seenCounterparties.add(other);
        }
      }
    }
    for (const cp of seenCounterparties) {
      counterpartyCount.set(cp, (counterpartyCount.get(cp) || 0) + 1);
    }
  }
  const lpThreshold = Math.max(3, Math.floor(topHolders.length * 0.3));
  const poolAddresses = new Set<string>();
  for (const [addr, count] of counterpartyCount) {
    if (count >= lpThreshold) poolAddresses.add(addr);
  }
  if (poolAddresses.size > 0) {
    console.log(`Filtered ${poolAddresses.size} pool/LP addresses (threshold: ${lpThreshold}+ holders)`);
  }

  // 4a: Create holder nodes
  for (const holder of topHolders) {
    const isSniper = sniperSet.has(holder.owner);
    const isBundled = bundledWalletSet.has(holder.owner);
    const buyData = sniperBuyInfo.get(holder.owner);
    const identity = identities.get(holder.owner);
    const funderResult = fundedByResults.find(r => r.owner === holder.owner);

    const nodeType = isSniper ? 'sniper' : isBundled ? 'bundled' : 'holder';
    const holderNode = createNode(holder.owner, 1, nodeType, holder.amount,
      isSniper ? { isSniper: true, blocksAfterLaunch: buyData?.blocksAfterLaunch, suspicious: true }
      : isBundled ? { suspicious: true, isBundled: true } : undefined
    );

    if (identity?.name) {
      holderNode.identity = { name: identity.name, category: identity.category, type: identity.type, tags: identity.tags };
      holderNode.label = identity.name;
    }

    if (funderResult?.funder) {
      const fi = funderIdentities.get(funderResult.funder.address) || identities.get(funderResult.funder.address);
      holderNode.fundingSource = {
        funderAddress: funderResult.funder.address,
        funderName: fi?.name || null,
        funderType: funderResult.funder.txSource !== 'UNKNOWN' ? funderResult.funder.txSource : fi?.category || null,
        amount: funderResult.funder.amount,
        timestamp: funderResult.funder.timestamp,
        signature: funderResult.funder.txSignature,
      };
    }

    nodes.push(holderNode);
    existingNodeIds.add(holder.owner);
  }

  // 4b: Create ALL funder nodes + funder→holder links (not just shared funders)
  // Skip any funder that is actually a pool/LP address
  const suspiciousWallets: string[] = [];
  let cabalConnectionsFound = 0;

  for (const [funder, fundedHolders] of funderMap) {
    if (poolAddresses.has(funder)) continue; // Skip LP/bonding curve
    const isShared = fundedHolders.length > 1;

    if (isShared) {
      suspiciousWallets.push(funder);
      cabalConnectionsFound += fundedHolders.length;
    }

    let confidence = isShared ? 40 + Math.min(30, fundedHolders.length * 10) : 0;
    if (isShared && sniperWallets.some(s => fundedHolders.includes(s))) confidence += 15;
    if (isShared && bundledWalletSet.has(funder)) confidence += 10;

    // Create funder node if not already a holder
    if (!existingNodeIds.has(funder)) {
      const fi = funderIdentities.get(funder);
      const funderType = isShared ? 'cabal-funder' : 'funder';
      const funderNode = createNode(funder, 2, funderType, funderAmounts.get(funder) || 0,
        isShared ? { suspicious: true, fundedCount: fundedHolders.length, cabalConfidence: Math.min(100, confidence) } : undefined
      );
      if (fi?.name) {
        funderNode.identity = { name: fi.name, category: fi.category, type: fi.type, tags: fi.tags };
        funderNode.label = fi.name;
      }
      nodes.push(funderNode);
      existingNodeIds.add(funder);
    } else if (isShared) {
      // Upgrade existing node to cabal-funder
      const idx = nodes.findIndex(n => n.id === funder);
      if (idx !== -1) {
        nodes[idx] = { ...nodes[idx], type: 'cabal-funder', color: NODE_COLORS['cabal-funder'],
          metadata: { ...nodes[idx].metadata, suspicious: true, fundedCount: fundedHolders.length, cabalConfidence: Math.min(100, confidence) },
        };
      }
    }

    // Create funder→holder links for ALL connections
    for (const holder of fundedHolders) {
      const key = `${funder}->${holder}`;
      if (!linkSet.has(key)) {
        linkSet.add(key);
        links.push(createLink(funder, holder, funderAmounts.get(funder) || 0, undefined, { suspicious: isShared }));
      }
    }
  }

  // 4c: Detect direct holder-to-holder transfers, skipping pools and programs
  for (const [holderAddr, txs] of holderEarlyTxs) {
    if (!holderSet.has(holderAddr)) continue;
    for (const tx of txs) {
      if (tx.nativeTransfers) {
        for (const transfer of tx.nativeTransfers) {
          if (transfer.amount < 10000) continue; // Skip dust
          const from = transfer.fromUserAccount;
          const to = transfer.toUserAccount;
          if (poolAddresses.has(from) || poolAddresses.has(to)) continue;
          if (shouldFilterAddress(from) || shouldFilterAddress(to)) continue;

          if (holderSet.has(from) && holderSet.has(to) && from !== to) {
            const key = `${from}->${to}`;
            if (!linkSet.has(key)) {
              linkSet.add(key);
              links.push(createLink(from, to, transfer.amount / 1e9));
            }
          }
        }
      }
      if (tx.tokenTransfers) {
        for (const transfer of tx.tokenTransfers) {
          if (!transfer.tokenAmount || transfer.tokenAmount <= 0) continue;
          const from = transfer.fromUserAccount;
          const to = transfer.toUserAccount;
          if (!from || !to) continue;
          if (poolAddresses.has(from) || poolAddresses.has(to)) continue;
          if (shouldFilterAddress(from) || shouldFilterAddress(to)) continue;

          if (holderSet.has(from) && holderSet.has(to) && from !== to) {
            const key = `${from}->${to}`;
            if (!linkSet.has(key)) {
              linkSet.add(key);
              links.push(createLink(from, to, transfer.tokenAmount));
            }
          }
        }
      }
    }
  }

  // 4d: Bundle cluster links — connect wallets that bought in the same slot
  for (const cluster of bundleClusters) {
    const wallets = cluster.wallets.filter(w => existingNodeIds.has(w));
    for (let i = 0; i < wallets.length; i++) {
      for (let j = i + 1; j < wallets.length; j++) {
        const key = `${wallets[i]}->${wallets[j]}`;
        const reverseKey = `${wallets[j]}->${wallets[i]}`;
        if (!linkSet.has(key) && !linkSet.has(reverseKey)) {
          linkSet.add(key);
          links.push(createLink(wallets[i], wallets[j], 0, undefined, { suspicious: true }));
        }
      }
    }
  }

  // 4e: Assign cluster groups for shared funders
  let groupId = 0;
  for (const [, holders] of funderMap) {
    if (holders.length > 1) {
      const gid = `cabal-${groupId++}`;
      for (const addr of holders) {
        const node = nodes.find(n => n.id === addr);
        if (node) {
          if (node.type === 'holder') { node.type = 'connected'; node.color = NODE_COLORS.connected; }
          node.metadata = { ...node.metadata, suspicious: true, sharedFunderGroup: gid };
        }
      }
    }
  }

  console.log(`Scan: ${suspiciousWallets.length} cabal, ${sniperWallets.length} snipers, ${links.length} links, ${nodes.length} nodes`);

  return {
    data: { nodes, links },
    stats: {
      totalHolders: filteredHolders.length, rawHolderCount: allHolders.length, filteredOut: filteredOutCount,
      analyzedHolders: topHolders.length, analysisIncomplete: false,
      cabalConnectionsFound, suspiciousWallets,
      dexFundedHolders: 0, freshWalletFunders: 0,
      snipersDetected: sniperWallets.length, sniperWallets,
      bundleClustersDetected: bundleClusters.length,
      bundledWallets: Array.from(bundledWalletSet),
    },
    tokenSecurity, tokenMetadata,
  };
}
