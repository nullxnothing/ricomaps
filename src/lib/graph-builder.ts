import { getWalletTransfers, getWalletFundedBy, batchIdentifyWallets, NATIVE_SOL_MINT } from './helius';
import { GraphNode, GraphLink, GraphData } from './types';
import { shouldFilterAddress } from './address-utils';
import { createNode } from './graph-utils';

interface TraceOptions {
  maxDepth?: number;
  maxNodesPerLevel?: number;
  minAmount?: number;
}

const DEFAULT_OPTIONS: TraceOptions = {
  maxDepth: 2,
  maxNodesPerLevel: 15,
  minAmount: 0.01,
};

/**
 * Trace funding chain using Helius getTransfersByAddress + /funded-by
 * BFS traversal from target wallet, mapping all funding relationships
 */
export async function traceFundingChain(
  targetWallet: string,
  options: TraceOptions = {}
): Promise<GraphData> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const visited = new Set<string>();
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const queue: { wallet: string; depth: number }[] = [{ wallet: targetWallet, depth: 0 }];

  const targetNode = createNode(targetWallet, 0, 'target');
  nodes.push(targetNode);
  visited.add(targetWallet);

  while (queue.length > 0) {
    const { wallet, depth } = queue.shift()!;
    if (depth >= (opts.maxDepth || 2)) continue;

    try {
      const [incomingResult, outgoingResult, fundedBy] = await Promise.all([
        getWalletTransfers(wallet, {
          limit: 100,
          direction: 'in',
          mint: NATIVE_SOL_MINT,
          sortOrder: 'desc',
          solMode: 'merged',
        }),
        getWalletTransfers(wallet, {
          limit: 100,
          direction: 'out',
          mint: NATIVE_SOL_MINT,
          sortOrder: 'desc',
          solMode: 'merged',
        }),
        getWalletFundedBy(wallet),
      ]);

      const incomingSOL = incomingResult?.data ?? [];
      const outgoingSOL = outgoingResult?.data ?? [];
      if (incomingSOL.length === 0 && outgoingSOL.length === 0) continue;

      let nodesAddedThisLevel = 0;
      const minAmount = opts.minAmount || 0.01;

      // Dedupe by counterparty, sum amounts
      const funderAmounts = new Map<string, { total: number; count: number; firstSig: string; firstTs: number }>();
      for (const transfer of incomingSOL.filter(t => t.amount >= minAmount)) {
        if (shouldFilterAddress(transfer.counterparty)) continue;
        const existing = funderAmounts.get(transfer.counterparty);
        if (existing) {
          existing.total += transfer.amount;
          existing.count++;
        } else {
          funderAmounts.set(transfer.counterparty, {
            total: transfer.amount,
            count: 1,
            firstSig: transfer.signature,
            firstTs: transfer.timestamp,
          });
        }
      }

      // Sort by total amount (biggest funders first)
      const sortedFunders = Array.from(funderAmounts.entries())
        .sort((a, b) => b[1].total - a[1].total);

      for (const [funderAddr, info] of sortedFunders) {
        if (nodesAddedThisLevel >= (opts.maxNodesPerLevel || 15)) break;

        // Add link
        const existingLink = links.find(l => l.source === funderAddr && l.target === wallet);
        if (!existingLink) {
          links.push({
            source: funderAddr,
            target: wallet,
            value: info.total,
            txSignature: info.firstSig,
            timestamp: info.firstTs,
          });
        }

        if (!visited.has(funderAddr)) {
          visited.add(funderAddr);
          nodesAddedThisLevel++;

          const funderNode = createNode(funderAddr, depth + 1, 'funder', info.total);

          // Enrich with funded-by identity if this is the primary funder
          if (fundedBy && fundedBy.address === funderAddr && fundedBy.txSource !== 'UNKNOWN') {
            funderNode.fundingSource = {
              funderAddress: fundedBy.address,
              funderName: null,
              funderType: fundedBy.txSource,
              amount: fundedBy.amount,
              timestamp: fundedBy.timestamp,
              signature: fundedBy.txSignature,
            };
          }

          nodes.push(funderNode);
          queue.push({ wallet: funderAddr, depth: depth + 1 });
        }
      }

      const fundedAmounts = new Map<string, { total: number; firstSig: string }>();
      for (const transfer of outgoingSOL.filter(t => t.amount >= minAmount)) {
        if (shouldFilterAddress(transfer.counterparty)) continue;
        const existing = fundedAmounts.get(transfer.counterparty);
        if (existing) {
          existing.total += transfer.amount;
        } else {
          fundedAmounts.set(transfer.counterparty, {
            total: transfer.amount,
            firstSig: transfer.signature,
          });
        }
      }

      // Store metadata on the current node
      const currentNode = nodes.find(n => n.id === wallet);
      if (currentNode) {
        currentNode.expanded = true;
        currentNode.metadata = {
          ...currentNode.metadata,
          totalTransfers: incomingSOL.length + outgoingSOL.length,
          transferPatterns: {
            totalIn: incomingSOL.reduce((sum, t) => sum + t.amount, 0),
            totalOut: outgoingSOL.reduce((sum, t) => sum + t.amount, 0),
            uniqueCounterparties: new Set([...incomingSOL, ...outgoingSOL].map(t => t.counterparty)).size,
          },
        };
      }
    } catch (error) {
      console.error(`Error tracing wallet ${wallet}:`, error);
    }
  }

  // Batch identify all discovered wallets (1 API call for up to 100)
  const allAddresses = nodes.map(n => n.id);
  const identities = await batchIdentifyWallets(allAddresses);

  for (const node of nodes) {
    const identity = identities.get(node.id);
    if (identity) {
      node.identity = {
        name: identity.name,
        category: identity.category,
        type: identity.type,
        tags: identity.tags,
      };
      if (identity.name) {
        node.label = identity.name;
      }
    }
  }

  return { nodes, links };
}

/**
 * Expand a node on-demand using Helius getTransfersByAddress
 */
export async function expandNode(
  wallet: string,
  mode: 'funding' | 'funded',
  existingNodeIds: Set<string>
): Promise<{ newNodes: GraphNode[]; newLinks: GraphLink[] }> {
  const newNodes: GraphNode[] = [];
  const newLinks: GraphLink[] = [];

  try {
    const transfersResult = await getWalletTransfers(wallet, {
      limit: 100,
      direction: mode === 'funding' ? 'in' : 'out',
      mint: NATIVE_SOL_MINT,
      sortOrder: 'desc',
      solMode: 'merged',
    });
    if (!transfersResult?.data) return { newNodes, newLinks };

    const seenAddresses = new Set<string>();

    const relevantTransfers = transfersResult.data.filter(t =>
      t.amount >= 0.01
    );

    // Dedupe and sum
    const counterpartyAmounts = new Map<string, { total: number; sig: string }>();
    for (const t of relevantTransfers) {
      if (shouldFilterAddress(t.counterparty)) continue;
      const existing = counterpartyAmounts.get(t.counterparty);
      if (existing) {
        existing.total += t.amount;
      } else {
        counterpartyAmounts.set(t.counterparty, { total: t.amount, sig: t.signature });
      }
    }

    const sorted = Array.from(counterpartyAmounts.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15);

    for (const [addr, info] of sorted) {
      if (seenAddresses.has(addr)) continue;
      seenAddresses.add(addr);

      if (!existingNodeIds.has(addr)) {
        const nodeType = mode === 'funding' ? 'funder' : 'funded';
        newNodes.push(createNode(addr, 0, nodeType, info.total));
      }

      if (mode === 'funding') {
        newLinks.push({ source: addr, target: wallet, value: info.total, txSignature: info.sig });
      } else {
        newLinks.push({ source: wallet, target: addr, value: info.total, txSignature: info.sig });
      }
    }

    // Batch identify new nodes
    if (newNodes.length > 0) {
      const identities = await batchIdentifyWallets(newNodes.map(n => n.id));
      for (const node of newNodes) {
        const identity = identities.get(node.id);
        if (identity?.name) {
          node.identity = { name: identity.name, category: identity.category, type: identity.type, tags: identity.tags };
          node.label = identity.name;
        }
      }
    }
  } catch (error) {
    console.error(`Error expanding node ${wallet}:`, error);
  }

  return { newNodes, newLinks };
}
