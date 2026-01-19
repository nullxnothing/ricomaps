import { getTransactionsForAddress } from './helius';
import { GraphNode, GraphLink, GraphData, FunderInfo, NODE_COLORS } from './types';
import { truncateAddress, shouldFilterAddress } from './address-utils';

interface TraceOptions {
  maxDepth?: number;
  maxNodesPerLevel?: number;
  minAmount?: number;  // Minimum SOL amount to track (filter dust)
}

const DEFAULT_OPTIONS: TraceOptions = {
  maxDepth: 2,
  maxNodesPerLevel: 20,
  minAmount: 0.001,  // 0.001 SOL minimum
};

function createNode(
  address: string,
  depth: number,
  type: GraphNode['type'],
  amount?: number
): GraphNode {
  return {
    id: address,
    label: truncateAddress(address),
    val: Math.max(5, Math.log10((amount || 1) + 1) * 10),  // Size based on amount
    color: NODE_COLORS[type] || NODE_COLORS.default,
    type,
    depth,
    solBalance: amount,
    expanded: false,
    metadata: {
      fundedBy: [],
      funded: [],
    },
  };
}

function createLink(
  source: string,
  target: string,
  amount: number,
  txSignature?: string,
  timestamp?: number,
  suspicious?: boolean
): GraphLink {
  return {
    source,
    target,
    value: amount,
    txSignature,
    timestamp,
    suspicious,
  };
}

function extractFunders(tx: {
  signature: string;
  timestamp: number;
  nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>;
  accountData?: Array<{ account: string; nativeBalanceChange: number }>;
}, targetWallet: string, minAmount: number): FunderInfo[] {
  const funders: FunderInfo[] = [];

  // Check native transfers first (more reliable)
  if (tx.nativeTransfers) {
    for (const transfer of tx.nativeTransfers) {
      if (transfer.toUserAccount === targetWallet && transfer.amount > 0) {
        const amountSol = transfer.amount / 1e9;
        if (amountSol >= minAmount && !shouldFilterAddress(transfer.fromUserAccount)) {
          funders.push({
            address: transfer.fromUserAccount,
            amount: amountSol,
            timestamp: tx.timestamp,
            txSignature: tx.signature,
          });
        }
      }
    }
  }

  // Fallback to accountData if no native transfers found
  if (funders.length === 0 && tx.accountData) {
    // Find the target account's positive balance change
    const targetAccount = tx.accountData.find(
      a => a.account === targetWallet && a.nativeBalanceChange > 0
    );

    if (targetAccount) {
      // Find who sent it (account with negative balance change)
      const senders = tx.accountData.filter(
        a => a.nativeBalanceChange < 0 && a.account !== targetWallet
      );

      for (const sender of senders) {
        const amountSol = Math.abs(sender.nativeBalanceChange) / 1e9;
        if (amountSol >= minAmount && !shouldFilterAddress(sender.account)) {
          funders.push({
            address: sender.account,
            amount: amountSol,
            timestamp: tx.timestamp,
            txSignature: tx.signature,
          });
        }
      }
    }
  }

  return funders;
}

export async function traceFundingChain(
  targetWallet: string,
  options: TraceOptions = {}
): Promise<GraphData> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const visited = new Set<string>();
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const queue: { wallet: string; depth: number }[] = [{ wallet: targetWallet, depth: 0 }];

  // Add target node
  const targetNode = createNode(targetWallet, 0, 'target');
  nodes.push(targetNode);
  visited.add(targetWallet);

  while (queue.length > 0) {
    const { wallet, depth } = queue.shift()!;

    // Stop if we've reached max depth
    if (depth >= (opts.maxDepth || 2)) continue;

    try {
      // Get earliest transactions (funding sources)
      const txs = await getTransactionsForAddress(wallet, {
        sortOrder: 'asc',
        limit: 50,
      });

      let nodesAddedThisLevel = 0;

      // Analyze each transaction for incoming SOL
      for (const tx of txs) {
        if (nodesAddedThisLevel >= (opts.maxNodesPerLevel || 20)) break;

        const funders = extractFunders(tx, wallet, opts.minAmount || 0.001);

        for (const funder of funders) {
          if (nodesAddedThisLevel >= (opts.maxNodesPerLevel || 20)) break;

          // Create link even if node already exists (shows the connection)
          const existingLink = links.find(
            l => l.source === funder.address && l.target === wallet
          );

          if (!existingLink) {
            links.push(createLink(
              funder.address,
              wallet,
              funder.amount,
              funder.txSignature,
              funder.timestamp
            ));
          }

          if (!visited.has(funder.address)) {
            visited.add(funder.address);
            nodesAddedThisLevel++;

            // Create funder node
            const funderNode = createNode(
              funder.address,
              depth + 1,
              'funder',
              funder.amount
            );
            nodes.push(funderNode);

            // Add to queue for next level
            queue.push({ wallet: funder.address, depth: depth + 1 });
          }
        }
      }

      // Mark current node as expanded
      const currentNode = nodes.find(n => n.id === wallet);
      if (currentNode) {
        currentNode.expanded = true;
      }
    } catch (error) {
      console.error(`Error tracing wallet ${wallet}:`, error);
      // Continue with other wallets
    }
  }

  return { nodes, links };
}

export async function expandNode(
  wallet: string,
  mode: 'funding' | 'funded',
  existingNodeIds: Set<string>
): Promise<{ newNodes: GraphNode[]; newLinks: GraphLink[] }> {
  const newNodes: GraphNode[] = [];
  const newLinks: GraphLink[] = [];

  try {
    const txs = await getTransactionsForAddress(wallet, {
      sortOrder: mode === 'funding' ? 'asc' : 'desc',
      limit: 50,
    });

    const seenAddresses = new Set<string>();

    for (const tx of txs) {
      if (newNodes.length >= 10) break;  // Limit expansion

      if (mode === 'funding') {
        // Find funders (same as traceFundingChain)
        const funders = extractFunders(tx, wallet, 0.001);
        for (const funder of funders) {
          if (!existingNodeIds.has(funder.address) && !seenAddresses.has(funder.address)) {
            seenAddresses.add(funder.address);
            newNodes.push(createNode(funder.address, 0, 'funder', funder.amount));
            newLinks.push(createLink(funder.address, wallet, funder.amount, funder.txSignature));
          }
        }
      } else {
        // Find funded wallets (who did this wallet send to)
        if (tx.nativeTransfers) {
          for (const transfer of tx.nativeTransfers) {
            if (transfer.fromUserAccount === wallet && transfer.amount > 0) {
              const recipient = transfer.toUserAccount;
              const amountSol = transfer.amount / 1e9;

              if (!existingNodeIds.has(recipient) && !seenAddresses.has(recipient) && !shouldFilterAddress(recipient) && amountSol >= 0.001) {
                seenAddresses.add(recipient);
                newNodes.push(createNode(recipient, 0, 'funded', amountSol));
                newLinks.push(createLink(wallet, recipient, amountSol, tx.signature));
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error expanding node ${wallet}:`, error);
  }

  return { newNodes, newLinks };
}
