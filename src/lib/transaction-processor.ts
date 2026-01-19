/**
 * Transaction Processor
 *
 * Converts raw Helius transactions to graph updates for real-time streaming.
 */

import { GraphNode, GraphLink, GraphUpdate, HeliusTransaction, NODE_COLORS } from './types';

/**
 * Process a single transaction into graph updates
 */
export function processTransactionToGraphUpdate(
  tx: HeliusTransaction,
  watchedAddresses: string[],
  existingNodeIds: Set<string>
): GraphUpdate {
  const newNodes: GraphNode[] = [];
  const newLinks: GraphLink[] = [];
  const watchedSet = new Set(watchedAddresses);

  // Process native (SOL) transfers
  if (tx.nativeTransfers) {
    for (const transfer of tx.nativeTransfers) {
      const isWatchedSource = watchedSet.has(transfer.fromUserAccount);
      const isWatchedTarget = watchedSet.has(transfer.toUserAccount);

      // Skip if neither party is watched
      if (!isWatchedSource && !isWatchedTarget) continue;

      // Skip dust amounts (less than 0.001 SOL)
      const solAmount = transfer.amount / 1e9;
      if (solAmount < 0.001) continue;

      // Determine the "other" party and create node if needed
      const otherAddress = isWatchedSource
        ? transfer.toUserAccount
        : transfer.fromUserAccount;

      // Create node for the other party if not already existing
      if (!existingNodeIds.has(otherAddress)) {
        const nodeType = isWatchedSource ? 'funded' : 'funder';
        newNodes.push(createNode(otherAddress, solAmount, nodeType));
        existingNodeIds.add(otherAddress);
      }

      // Create the link
      newLinks.push({
        source: transfer.fromUserAccount,
        target: transfer.toUserAccount,
        value: solAmount,
        timestamp: tx.timestamp,
        txSignature: tx.signature,
        suspicious: false,
      });
    }
  }

  // Process account data for balance changes (backup method)
  if (tx.accountData && newLinks.length === 0) {
    const watchedAccount = tx.accountData.find(
      acc => watchedSet.has(acc.account) && acc.nativeBalanceChange !== 0
    );

    if (watchedAccount) {
      const isIncoming = watchedAccount.nativeBalanceChange > 0;
      const solAmount = Math.abs(watchedAccount.nativeBalanceChange) / 1e9;

      if (solAmount >= 0.001) {
        // Find the counterparty
        const counterparty = tx.accountData.find(
          acc => !watchedSet.has(acc.account) &&
            acc.nativeBalanceChange !== 0 &&
            Math.sign(acc.nativeBalanceChange) !== Math.sign(watchedAccount.nativeBalanceChange)
        );

        if (counterparty && !existingNodeIds.has(counterparty.account)) {
          const nodeType = isIncoming ? 'funder' : 'funded';
          newNodes.push(createNode(counterparty.account, solAmount, nodeType));
          existingNodeIds.add(counterparty.account);

          newLinks.push({
            source: isIncoming ? counterparty.account : watchedAccount.account,
            target: isIncoming ? watchedAccount.account : counterparty.account,
            value: solAmount,
            timestamp: tx.timestamp,
            txSignature: tx.signature,
            suspicious: false,
          });
        }
      }
    }
  }

  return { newNodes, newLinks };
}

/**
 * Create a new graph node
 */
function createNode(
  address: string,
  amount: number,
  type: 'funder' | 'funded' | 'holder'
): GraphNode {
  return {
    id: address,
    label: truncateAddress(address),
    val: Math.max(1, Math.sqrt(amount) * 2),
    color: NODE_COLORS[type] || NODE_COLORS.default,
    type,
    depth: 1,
    solBalance: amount,
    expanded: false,
    metadata: {
      firstTx: Date.now(),
      txCount: 1,
    },
  };
}

/**
 * Truncate address for display
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Merge graph updates into existing graph data with deduplication
 */
export function mergeGraphUpdate(
  existingNodes: GraphNode[],
  existingLinks: GraphLink[],
  update: GraphUpdate
): { nodes: GraphNode[]; links: GraphLink[] } {
  const existingNodeIds = new Set(existingNodes.map(n => n.id));
  const existingLinkKeys = new Set(
    existingLinks.map(l => `${l.source}->${l.target}`)
  );

  // Filter out duplicate nodes
  const uniqueNewNodes = update.newNodes.filter(n => !existingNodeIds.has(n.id));

  // Build final node ID set (existing + new)
  const finalNodeIds = new Set(existingNodeIds);
  for (const node of uniqueNewNodes) {
    finalNodeIds.add(node.id);
  }

  // Filter out duplicate links AND links where source/target doesn't exist
  // This prevents "node not found" crashes in d3-force-3d
  const uniqueNewLinks = update.newLinks.filter(l => {
    // Skip if already exists
    if (existingLinkKeys.has(`${l.source}->${l.target}`)) return false;
    // Skip if source or target node doesn't exist
    if (!finalNodeIds.has(l.source) || !finalNodeIds.has(l.target)) {
      console.warn(`[mergeGraphUpdate] Skipping orphan link: ${l.source} -> ${l.target}`);
      return false;
    }
    return true;
  });

  return {
    nodes: [...existingNodes, ...uniqueNewNodes],
    links: [...existingLinks, ...uniqueNewLinks],
  };
}

/**
 * Batch process multiple transactions
 */
export function processTransactionBatch(
  transactions: HeliusTransaction[],
  watchedAddresses: string[],
  existingNodeIds: Set<string>
): GraphUpdate {
  const allNewNodes: GraphNode[] = [];
  const allNewLinks: GraphLink[] = [];
  const processedNodeIds = new Set(existingNodeIds);

  for (const tx of transactions) {
    const update = processTransactionToGraphUpdate(tx, watchedAddresses, processedNodeIds);
    allNewNodes.push(...update.newNodes);
    allNewLinks.push(...update.newLinks);
  }

  // Deduplicate nodes
  const uniqueNodes: GraphNode[] = [];
  const seenIds = new Set<string>();
  for (const node of allNewNodes) {
    if (!seenIds.has(node.id)) {
      uniqueNodes.push(node);
      seenIds.add(node.id);
    }
  }

  // Deduplicate links
  const uniqueLinks: GraphLink[] = [];
  const seenLinkKeys = new Set<string>();
  for (const link of allNewLinks) {
    const key = `${link.source}->${link.target}`;
    if (!seenLinkKeys.has(key)) {
      uniqueLinks.push(link);
      seenLinkKeys.add(key);
    }
  }

  return { newNodes: uniqueNodes, newLinks: uniqueLinks };
}
