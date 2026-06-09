import {
  getTokenLargestAccounts, getMultipleAccountsParsed, getMintEarlyTransactions,
  getAsset, deriveTokenSecurity, batchIdentifyWallets, batchGetEarlyTransactions,
  batchGetFirstIncomingSolTransfers, searchAssetsByCreator, getWalletFundedBy,
} from './helius';
import { GraphNode, GraphLink, GraphData, NODE_COLORS, TokenSecurityInfo, TokenMetadata, EnrichedFunderInfo, BundleCluster, SupplyConcentration, RugScore, DeployerInfo, CabalFingerprintResult } from './types';
import { computeThreatScore, getThreatLevel } from './threat-scorer';
import { computeSupplyConcentration } from './supply-metrics';
import { computeRugScore } from './rug-scorer';
import { extractDeployer, computeDeployerHoldings, buildDeployerInfo } from './deployer';
import { shouldFilterAddress } from './address-utils';
import { createNode } from './graph-utils';
import { detectBundleClusters } from './bundle-detector';
import { generateClusterId, persistBundleClusters } from './db-blacklist';
import { computeFingerprintId, deriveFingerprintComponents, upsertCabalFingerprint, findMatchingCabals } from './cabal-fingerprint';
import { upsertAtlasToken } from './db-cabal';
import { extractBehavioralFeatures, clusterByBehavior } from './behavioral-cluster';
import { fetchTokenMarketData } from './dexscreener';
import { getVenumPriceUsd } from './venum';

const SNIPER_BLOCK_THRESHOLD = 10;

interface MapOptions {
  topN?: number;
  fundersPerHolder?: number;
}

const DEFAULT_OPTIONS: MapOptions = { topN: 20, fundersPerHolder: 1 };

function createLink(source: string, target: string, amount: number, txSig?: string, opts?: { suspicious?: boolean }): GraphLink {
  return { source, target, value: amount, txSignature: txSig, suspicious: opts?.suspicious };
}

function mergeBundleClusters(clusters: BundleCluster[]): BundleCluster[] {
  const byId = new Map<string, BundleCluster>();

  for (const cluster of clusters) {
    const existing = byId.get(cluster.id);
    if (!existing) {
      byId.set(cluster.id, { ...cluster, tokens: [...cluster.tokens] });
      continue;
    }

    const existingMints = new Set(existing.tokens.map(t => t.mint));
    existing.tokens.push(...cluster.tokens.filter(t => !existingMints.has(t.mint)));
    existing.totalAppearances = existing.tokens.length;
    existing.confidence = Math.max(existing.confidence, cluster.confidence);
    existing.firstSeenTimestamp = Math.min(existing.firstSeenTimestamp, cluster.firstSeenTimestamp);
    existing.lastSeenTimestamp = Math.max(existing.lastSeenTimestamp, cluster.lastSeenTimestamp);
    existing.sharedFunder = existing.sharedFunder || cluster.sharedFunder;
    existing.metadata = {
      avgClusterSize: Math.max(existing.metadata?.avgClusterSize ?? 0, cluster.metadata?.avgClusterSize ?? 0),
      maxSameSlotCount: Math.max(existing.metadata?.maxSameSlotCount ?? 0, cluster.metadata?.maxSameSlotCount ?? 0),
    };
  }

  return Array.from(byId.values());
}

/** Optimized token scan pipeline — ~25 API calls in <1s */
export async function mapTokenHolders(mintAddress: string, options: MapOptions = {}): Promise<{
  data: GraphData;
  stats: {
    totalHolders: number; rawHolderCount: number; filteredOut: number;
    analyzedHolders: number; analysisIncomplete: boolean;
    cabalConnectionsFound: number; suspiciousWallets: string[];
    dexFundedHolders: number; freshWalletFunders: number;
    snipersDetected: number; sniperWallets: string[];
    bundleClustersDetected: number; bundledWallets: string[];
    behavioralClustersDetected: number; behaviorallyClusteredWallets: string[];
    supplyConcentration: SupplyConcentration;
    rugScore: RugScore;
    cabalFingerprint?: CabalFingerprintResult;
  };
  tokenSecurity: TokenSecurityInfo | null;
  tokenMetadata: TokenMetadata | null;
  deployerInfo: DeployerInfo | null;
}> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  // ═══════════════════════════════════════════════════════════
  // PHASE 1: Three parallel calls (~200ms)
  // ═══════════════════════════════════════════════════════════
  const p1Start = Date.now();
  const [largestAccounts, asset, mintEarlyTxs, dexMarketData, venumPriceUsd] = await Promise.all([
    getTokenLargestAccounts(mintAddress),
    getAsset(mintAddress),
    getMintEarlyTransactions(mintAddress, 100),
    fetchTokenMarketData(mintAddress),
    // Venum multi-DEX price resolves on fresh launches where Gecko/DexScreener
    // are still empty; null when unconfigured or no pool yet (we then fall back).
    getVenumPriceUsd(mintAddress),
  ]);
  console.error(`[PERF] Phase 1: ${Date.now() - p1Start}ms`);

  // Derive security + metadata from asset (CPU only, zero API calls)
  const tokenSecurity = asset ? deriveTokenSecurity(asset) : null;

  const tokenMetadata: TokenMetadata | null = asset ? {
    name: asset.content?.metadata?.name,
    symbol: asset.content?.metadata?.symbol,
    image: asset.content?.links?.image || asset.content?.files?.[0]?.uri,
    description: asset.content?.metadata?.description,
    website: asset.content?.links?.external_url,
    ...dexMarketData,
    // Prefer the live Venum price over the (possibly stale/missing) DEX snapshot.
    ...(venumPriceUsd != null ? { priceUsd: venumPriceUsd } : {}),
  } : (dexMarketData || venumPriceUsd != null)
    ? { ...dexMarketData, ...(venumPriceUsd != null ? { priceUsd: venumPriceUsd } : {}) }
    : null;

  // Derive launch info from first mint tx (CPU only)
  const launchInfo = mintEarlyTxs.length > 0 ? {
    mintTimestamp: mintEarlyTxs[0].blockTime || 0,
    mintSlot: mintEarlyTxs[0].slot,
  } : null;

  // Resolve deployer (CPU only) so its history/funding can be fetched alongside Phase 2.
  const resolvedDeployer = extractDeployer(mintEarlyTxs, asset);

  // ═══════════════════════════════════════════════════════════
  // PHASE 1b: Resolve token accounts → owner wallets (~80ms)
  // ═══════════════════════════════════════════════════════════
  const p1bStart = Date.now();
  const tokenAccountAddresses = largestAccounts.map(a => a.address);
  const accountDetails = await getMultipleAccountsParsed(tokenAccountAddresses);
  console.error(`[PERF] Phase 1b: ${Date.now() - p1bStart}ms`);

  // Build holder list from resolved accounts
  const rawHolders: { owner: string; amount: number; tokenAccount: string }[] = [];
  for (const la of largestAccounts) {
    const detail = accountDetails.get(la.address);
    if (detail && detail.owner) {
      rawHolders.push({
        owner: detail.owner,
        amount: detail.amount > 0 ? detail.amount : la.amount,
        tokenAccount: la.address,
      });
    }
  }

  // Filter: programs, mint itself, LP/bonding curve holders (>40%)
  const preFiltered = rawHolders.filter(h => h.amount > 0 && !shouldFilterAddress(h.owner) && h.owner !== mintAddress);
  const totalAmount = preFiltered.reduce((sum, h) => sum + h.amount, 0);
  const LP_THRESHOLD_RATIO = 0.4;
  const filteredHolders = preFiltered.filter(h => {
    if (totalAmount > 0 && (h.amount / totalAmount) > LP_THRESHOLD_RATIO) return false;
    return true;
  });
  const filteredOutCount = rawHolders.length - filteredHolders.length;
  const topHolders = filteredHolders.sort((a, b) => b.amount - a.amount).slice(0, opts.topN || 30);
  const holderSet = new Set(topHolders.map(h => h.owner));
  const holderAddresses = topHolders.map(h => h.owner);

  nodes.push(createNode(mintAddress, 0, 'token', rawHolders.reduce((sum, h) => sum + h.amount, 0)));

  // ═══════════════════════════════════════════════════════════
  // PHASE 2: Fetch early txs for launch clustering and first incoming SOL funders
  // ═══════════════════════════════════════════════════════════
  // Deployer history (only for an attributable human signer — never a program/PDA)
  // and the deployer's own funding source. Overlapped with holder fetches → no
  // added wall-clock.
  const runDeployerHistory = resolvedDeployer && !resolvedDeployer.unattributable;
  const p2Start = Date.now();
  const [holderEarlyTxs, firstFunders, deployerHistory, deployerFundedBy] = await Promise.all([
    batchGetEarlyTransactions(holderAddresses, 5),
    batchGetFirstIncomingSolTransfers(holderAddresses, { fallbackToFundedBy: true, concurrency: 8 }),
    runDeployerHistory ? searchAssetsByCreator(resolvedDeployer.address, { limit: 50 }) : Promise.resolve(null),
    runDeployerHistory ? getWalletFundedBy(resolvedDeployer.address) : Promise.resolve(null),
  ]);
  console.error(`[PERF] Phase 2: ${Date.now() - p2Start}ms (${holderAddresses.length} holders)`);

  const fundedByResults = topHolders.map(h => ({
    owner: h.owner,
    funder: firstFunders.get(h.owner) ?? null,
  }));

  const funderMap = new Map<string, string[]>();
  const funderAmounts = new Map<string, number>();
  const funderInfo = new Map<string, EnrichedFunderInfo>();
  const funderHolderLinks = new Map<string, EnrichedFunderInfo>();

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
      if (info) funderHolderLinks.set(`${funderAddr}->${holderAddr}`, info);
    }
  }

  for (const { owner, funder } of fundedByResults) {
    if (!funder) continue;
    addLink(funder.address, owner, funder.amount, funder);
    if (holderSet.has(funder.address)) {
      addLink(funder.address, owner, funder.amount, funder);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 2b: Sniper + bundle detection from mint txs (CPU only, ~5ms)
  // ═══════════════════════════════════════════════════════════

  // Sniper detection: wallets that received tokens within first N blocks of mint
  const sniperWallets: string[] = [];
  const sniperBuyInfo = new Map<string, { blocksAfterLaunch: number }>();

  if (launchInfo && launchInfo.mintTimestamp > 0) {
    const mintSlot = launchInfo.mintSlot;
    for (const tx of mintEarlyTxs) {
      if (tx.slot - mintSlot > SNIPER_BLOCK_THRESHOLD) break;
      const postBalances = tx.meta?.postTokenBalances ?? [];
      for (const bal of postBalances) {
        if (bal.mint === mintAddress && bal.owner && bal.uiTokenAmount.uiAmount && bal.uiTokenAmount.uiAmount > 0) {
          if (holderSet.has(bal.owner) && !sniperWallets.includes(bal.owner)) {
            sniperWallets.push(bal.owner);
            sniperBuyInfo.set(bal.owner, { blocksAfterLaunch: tx.slot - mintSlot });
          }
        }
      }
    }
  }

  // Bundle detection: group early buyers by slot — 2+ wallets in same slot = bundle
  const holderTxBundleClusters = detectBundleClusters(holderEarlyTxs, {
    mintAddress,
    tokenName: tokenMetadata?.name,
    tokenSymbol: tokenMetadata?.symbol,
    funderMap,
  });

  // Also detect bundles from mint txs (wallets buying in same slot)
  const mintSlotBuyers = new Map<number, string[]>();
  for (const tx of mintEarlyTxs) {
    const postBalances = tx.meta?.postTokenBalances ?? [];
    for (const bal of postBalances) {
      if (bal.mint === mintAddress && bal.owner && holderSet.has(bal.owner)) {
        if (!mintSlotBuyers.has(tx.slot)) mintSlotBuyers.set(tx.slot, []);
        const buyers = mintSlotBuyers.get(tx.slot)!;
        if (!buyers.includes(bal.owner)) buyers.push(bal.owner);
      }
    }
  }

  const mintSlotBundleClusters: BundleCluster[] = [];
  for (const [slot, buyers] of mintSlotBuyers) {
    const wallets = [...new Set(buyers)].sort();
    let sharedFunder: string | undefined;
    for (const [funder, fundedHolders] of funderMap) {
      const overlap = wallets.filter(wallet => fundedHolders.includes(wallet));
      if (overlap.length >= 2) {
        sharedFunder = funder;
        break;
      }
    }

    if (wallets.length < 2) continue;
    if (wallets.length < 3 && !sharedFunder) continue;
    if (wallets.length > 5 && !sharedFunder) continue;

    const slotTxs = mintEarlyTxs.filter(tx => tx.slot === slot);
    const timestamps = slotTxs
      .map(tx => tx.blockTime || 0)
      .filter((timestamp): timestamp is number => timestamp > 0);
    const timestamp = timestamps.length > 0 ? Math.min(...timestamps) : Math.floor(Date.now() / 1000);

    mintSlotBundleClusters.push({
      id: generateClusterId(wallets),
      wallets,
      tokens: [{
        mint: mintAddress,
        tokenName: tokenMetadata?.name,
        tokenSymbol: tokenMetadata?.symbol,
        slot,
        timestamp,
        walletCount: wallets.length,
        transactionSignatures: [...new Set(slotTxs.flatMap(tx => {
          const transaction = tx.transaction as { signatures?: string[] };
          return transaction.signatures ?? [];
        }))],
      }],
      totalAppearances: 1,
      firstSeenTimestamp: timestamp,
      lastSeenTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : timestamp,
      confidence: Math.min(100, 35 + Math.min(25, (wallets.length - 2) * 8) + (sharedFunder ? 30 : 0)),
      sharedFunder,
      metadata: {
        avgClusterSize: wallets.length,
        maxSameSlotCount: wallets.length,
      },
    });
  }

  const bundleClusters = mergeBundleClusters([...holderTxBundleClusters, ...mintSlotBundleClusters]);

  if (bundleClusters.length > 0) {
    try {
      await persistBundleClusters(bundleClusters);
    } catch (error) {
      console.error('[Blacklist] Failed to persist bundle clusters:', error);
    }
  }

  const bundledWalletSet = new Set<string>();
  // From holder-tx-based bundle detection
  for (const cluster of bundleClusters) {
    for (const wallet of cluster.wallets) {
      bundledWalletSet.add(wallet);
    }
  }
  // From mint-tx-based bundle detection
  for (const [, buyers] of mintSlotBuyers) {
    if (buyers.length >= 2) {
      buyers.forEach(b => bundledWalletSet.add(b));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 3: Build funder connections + single merged identity call
  // ═══════════════════════════════════════════════════════════
  // Single merged identity call for all addresses
  const funderAddresses = [...new Set(
    fundedByResults.filter(r => r.funder).map(r => r.funder!.address)
  )].filter(a => !holderSet.has(a));
  const allIdentityAddresses = [...new Set([...holderAddresses, ...funderAddresses])];

  const p3Start = Date.now();
  const identities = await batchIdentifyWallets(allIdentityAddresses);
  console.error(`[PERF] Phase 3 identity: ${Date.now() - p3Start}ms (${allIdentityAddresses.length} addresses)`);

  // ═══════════════════════════════════════════════════════════
  // PHASE 4: Build graph — ALL connections (zero API calls)
  // ═══════════════════════════════════════════════════════════

  const sniperSet = new Set(sniperWallets);
  const existingNodeIds = new Set(nodes.map(n => n.id));
  const linkSet = new Set<string>();

  // 4-pre: Detect LP/bonding curve/pool addresses
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
  const LP_COUNTERPARTY_MIN = 3;
  const LP_COUNTERPARTY_RATIO = 0.3;
  const lpThreshold = Math.max(LP_COUNTERPARTY_MIN, Math.floor(topHolders.length * LP_COUNTERPARTY_RATIO));
  const poolAddresses = new Set<string>();
  for (const [addr, count] of counterpartyCount) {
    if (count >= lpThreshold) poolAddresses.add(addr);
  }

  // A single holder controlling a large share of circulating supply is almost
  // always a pool/AMM/treasury, not a real holder — tag those distinctly too.
  const POOL_SUPPLY_SHARE = 0.15;
  const holderSupplyTotal = topHolders.reduce((sum, h) => sum + h.amount, 0);

  // 4a: Create holder nodes
  for (const holder of topHolders) {
    const isSniper = sniperSet.has(holder.owner);
    const isBundled = bundledWalletSet.has(holder.owner);
    const isPool = poolAddresses.has(holder.owner) ||
      (holderSupplyTotal > 0 && holder.amount / holderSupplyTotal > POOL_SUPPLY_SHARE);
    const buyData = sniperBuyInfo.get(holder.owner);
    const identity = identities.get(holder.owner);
    const funderResult = fundedByResults.find(r => r.owner === holder.owner);

    // Pool takes priority — it's infrastructure, not a suspicious actor.
    const nodeType = isPool ? 'pool' : isSniper ? 'sniper' : isBundled ? 'bundled' : 'holder';
    const holderNode = createNode(holder.owner, 1, nodeType, holder.amount,
      isPool ? { isPool: true }
      : isSniper ? { isSniper: true, blocksAfterLaunch: buyData?.blocksAfterLaunch, suspicious: true }
      : isBundled ? { suspicious: true, isBundled: true } : undefined
    );

    if (identity?.name) {
      holderNode.identity = { name: identity.name, category: identity.category, type: identity.type, tags: identity.tags };
      holderNode.label = identity.name;
    }

    if (funderResult?.funder) {
      const fi = identities.get(funderResult.funder.address);
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

  // 4b: Create ALL funder nodes + funder->holder links
  const suspiciousWallets: string[] = [];
  let cabalConnectionsFound = 0;

  for (const [funder, fundedHolders] of funderMap) {
    if (poolAddresses.has(funder)) continue;
    const isShared = fundedHolders.length > 1;

    if (isShared) {
      suspiciousWallets.push(funder);
      cabalConnectionsFound += fundedHolders.length;
    }

    let confidence = isShared ? 40 + Math.min(30, fundedHolders.length * 10) : 0;
    if (isShared && sniperWallets.some(s => fundedHolders.includes(s))) confidence += 15;
    if (isShared && bundledWalletSet.has(funder)) confidence += 10;

    if (!existingNodeIds.has(funder)) {
      const fi = identities.get(funder);
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
      const idx = nodes.findIndex(n => n.id === funder);
      if (idx !== -1) {
        nodes[idx] = { ...nodes[idx], type: 'cabal-funder', color: NODE_COLORS['cabal-funder'],
          metadata: { ...nodes[idx].metadata, suspicious: true, fundedCount: fundedHolders.length, cabalConfidence: Math.min(100, confidence) },
        };
      }
    }

    for (const holder of fundedHolders) {
      const key = `${funder}->${holder}`;
      if (!linkSet.has(key)) {
        linkSet.add(key);
        const linkInfo = funderHolderLinks.get(key);
        links.push(createLink(
          funder,
          holder,
          linkInfo?.amount ?? 0,
          linkInfo?.txSignature,
          { suspicious: isShared },
        ));
      }
    }
  }

  // 4c: Detect direct holder-to-holder transfers
  for (const [holderAddr, txs] of holderEarlyTxs) {
    if (!holderSet.has(holderAddr)) continue;
    for (const tx of txs) {
      if (tx.nativeTransfers) {
        for (const transfer of tx.nativeTransfers) {
          if (transfer.amount < 10000) continue;
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

  // 4d: Bundle cluster links
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

  // 4f: Behavioral clustering — funding-independent crew detection.
  // Catches crews that launder their funding (no shared funder link) but still act
  // as one hand: same buy-slot, same co-buy cohort, similar age/size.
  const sameSlotMap = new Map<string, number>();
  for (const [, buyers] of mintSlotBuyers) {
    for (const b of buyers) sameSlotMap.set(b, Math.max(sameSlotMap.get(b) ?? 0, buyers.length - 1));
  }
  const depth1Nodes = nodes.filter(n => n.depth === 1 && n.tokenAmount !== undefined);
  const behavioralFeatures = extractBehavioralFeatures(depth1Nodes, sameSlotMap);
  const behavioralClusters = clusterByBehavior(behavioralFeatures);
  const behavioralClusterOf = new Map<string, number>();
  for (const c of behavioralClusters) for (const w of c.wallets) behavioralClusterOf.set(w, c.clusterId);

  const behaviorallyClusteredWallets: string[] = [];
  for (const node of nodes) {
    const bc = behavioralClusterOf.get(node.id);
    if (bc === undefined) continue;
    behaviorallyClusteredWallets.push(node.id);
    node.metadata = { ...node.metadata, behavioralCluster: `bhv-${bc}` };
    // Flagged by BOTH funding-cabal AND behavior → higher confidence.
    if (node.metadata.sharedFunderGroup) {
      node.metadata.cabalConfidence = Math.min(100, (node.metadata.cabalConfidence ?? 50) + 20);
      node.metadata.suspicious = true;
    }
  }

  // Compute threat scores for all nodes (after the behavioral confidence boost)
  for (const node of nodes) {
    const score = computeThreatScore(node);
    node.metadata = { ...node.metadata, threatScore: score, threatLevel: getThreatLevel(score) };
  }

  // ═══════════════════════════════════════════════════════════
  // PHASE 5: Supply-held concentration metrics (CPU only, zero API calls)
  // Derived from the built holder nodes so pool/bundle/sniper/cabal tagging is
  // the single source of truth and matches what the graph renders.
  // ═══════════════════════════════════════════════════════════
  const holderNodes = nodes.filter(n => n.depth === 1 && n.tokenAmount !== undefined);
  const poolNodeSet = new Set(holderNodes.filter(n => n.type === 'pool' || n.metadata?.isPool).map(n => n.id));
  const cabalWalletSet = new Set(holderNodes.filter(n => n.metadata?.sharedFunderGroup).map(n => n.id));

  const supplyDecimals = tokenSecurity?.decimals;
  const mintSupplyRaw = tokenSecurity?.supply;
  const mintSupply = mintSupplyRaw && supplyDecimals !== undefined
    ? Number(mintSupplyRaw) / 10 ** supplyDecimals
    : undefined;

  const supplyConcentration = computeSupplyConcentration({
    holders: holderNodes.map(n => ({
      owner: n.id,
      amount: n.tokenAmount ?? 0,
      firstFundedAt: n.fundingSource?.timestamp,
    })),
    bundledWallets: bundledWalletSet,
    sniperWallets: new Set(sniperWallets),
    cabalWallets: cabalWalletSet,
    poolWallets: poolNodeSet,
    mintSupply,
  });

  const rugScore = computeRugScore({
    security: tokenSecurity,
    supply: supplyConcentration,
    snipersDetected: sniperWallets.length,
    bundleClustersDetected: bundleClusters.length,
  });

  // ═══════════════════════════════════════════════════════════
  // PHASE 5b: Persistent cabal fingerprint (funding-source + topology basis)
  // Keyed so the crew is recognized across tokens even after wallet rotation.
  // Runs after rugScore/supplyConcentration so the rap-sheet carries outcomes.
  // ═══════════════════════════════════════════════════════════
  let cabalFingerprint: CabalFingerprintResult | undefined;
  const sharedFunders = [...funderMap.entries()].filter(([, h]) => h.length > 1).map(([f]) => f);
  if (sharedFunders.length > 0) {
    try {
      // Wallet-age proxy: a holder's first incoming SOL timestamp == its birth.
      const nowSec = Math.floor(Date.now() / 1000);
      const cabalAgesDays = holderNodes
        .filter(n => n.metadata?.sharedFunderGroup && n.fundingSource?.timestamp)
        .map(n => (nowSec - n.fundingSource!.timestamp) / 86400);

      const funderRoutes = sharedFunders.map(f => fundedByResults.find(r => r.funder?.address === f)?.funder);
      const components = deriveFingerprintComponents({
        sharedFunders,
        funderCategories: new Map(sharedFunders.map(f => [f, identities.get(f)?.category ?? null])),
        fanoutWidths: sharedFunders.map(f => funderMap.get(f)!.length),
        walletAgesDays: cabalAgesDays,
        viaMixer: funderRoutes.some(r => r?.viaMixer),
        viaBridge: funderRoutes.some(r => r?.txSource?.toUpperCase().includes('BRIDGE')),
      });
      const fpId = computeFingerprintId(components);
      const matches = await findMatchingCabals(fpId, components.funderAddresses);
      cabalFingerprint = { id: fpId, matches };

      await upsertCabalFingerprint({
        id: fpId,
        components,
        tokens: [{
          mint: mintAddress,
          tokenName: tokenMetadata?.name,
          tokenSymbol: tokenMetadata?.symbol,
          firstSeen: nowSec,
          walletCount: cabalWalletSet.size,
          rugLevel: rugScore.level,
          cabalSupplyPct: supplyConcentration.cabalSupplyPct,
        }],
        totalAppearances: 1,
        confidence: Math.min(100, 50 + matches.length * 15),
        firstSeen: nowSec,
        lastSeen: nowSec,
        knownWallets: [...cabalWalletSet, ...sharedFunders],
      });
    } catch (error) {
      console.error('[Fingerprint] derivation/upsert failed:', error);
    }
  }

  // PHASE 5c: Laundered-cabal feedback — a behavioral cluster with NO shared funder
  // is a crew that rotated/laundered funding. Fingerprint it on topology + behavior so
  // the radar can still recognize them despite the funding break.
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const c of behavioralClusters) {
      const hasSharedFunder = c.wallets.some(w => cabalWalletSet.has(w));
      if (hasSharedFunder || c.wallets.length < 2) continue;
      const components = deriveFingerprintComponents({
        sharedFunders: [],
        funderCategories: new Map(),
        fanoutWidths: [c.wallets.length],
        walletAgesDays: c.wallets
          .map(w => nodes.find(n => n.id === w)?.fundingSource?.timestamp)
          .filter((t): t is number => !!t)
          .map(t => (nowSec - t) / 86400),
        laundered: true,
      });
      const fpId = computeFingerprintId(components);
      await upsertCabalFingerprint({
        id: fpId, components,
        tokens: [{
          mint: mintAddress, tokenName: tokenMetadata?.name, tokenSymbol: tokenMetadata?.symbol,
          firstSeen: nowSec, walletCount: c.wallets.length, rugLevel: rugScore.level,
        }],
        totalAppearances: 1, confidence: Math.min(100, 40 + c.cohesion / 4),
        firstSeen: nowSec, lastSeen: nowSec, knownWallets: c.wallets,
        metadata: { reusedFunder: false },
      });
    }
  } catch (error) {
    console.error('[Fingerprint] laundered-cluster feedback failed:', error);
  }

  // Assemble deployer intel from the resolved signer + overlapped lookups.
  const deployerInfo: DeployerInfo | null = resolvedDeployer
    ? buildDeployerInfo({
        resolved: resolvedDeployer,
        holdings: computeDeployerHoldings(resolvedDeployer.address, holderNodes, supplyConcentration),
        pastLaunchCount: resolvedDeployer.unattributable ? null : (deployerHistory?.count ?? null),
        fundedBy: deployerFundedBy
          ? { address: deployerFundedBy.address, amount: deployerFundedBy.amount, source: deployerFundedBy.txSource }
          : null,
      })
    : null;

  // Atlas registry: every scan (user or automated) feeds the global cabal map.
  await upsertAtlasToken({
    mint: mintAddress,
    name: tokenMetadata?.name,
    symbol: tokenMetadata?.symbol,
    image: tokenMetadata?.image,
    status: 'scanned',
    scannedAt: Math.floor(Date.now() / 1000),
    liquidityUsd: tokenMetadata?.liquidity,
    marketCapUsd: tokenMetadata?.marketCap,
    rugLevel: rugScore.level,
    cabalSupplyPct: supplyConcentration.cabalSupplyPct,
  });

  return {
    data: { nodes, links },
    stats: {
      totalHolders: filteredHolders.length, rawHolderCount: rawHolders.length, filteredOut: filteredOutCount,
      analyzedHolders: topHolders.length, analysisIncomplete: false,
      cabalConnectionsFound, suspiciousWallets,
      dexFundedHolders: 0, freshWalletFunders: 0,
      snipersDetected: sniperWallets.length, sniperWallets,
      bundleClustersDetected: bundleClusters.length,
      bundledWallets: Array.from(bundledWalletSet),
      behavioralClustersDetected: behavioralClusters.length,
      behaviorallyClusteredWallets,
      supplyConcentration,
      rugScore,
      cabalFingerprint,
    },
    tokenSecurity, tokenMetadata, deployerInfo,
  };
}
