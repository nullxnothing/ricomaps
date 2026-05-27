import { GraphNode, GraphLink, GraphData, NODE_COLORS } from '@/lib/types';

export interface HistoricalSnapshot {
  slot: number;
  blockTime: number;
  holders: { address: string; balance: number; pctSupply: number }[];
  totalHolders: number;
  topHolderPct: number;
  top10Pct: number;
}

/**
 * Convert a historical snapshot to graph data for the bubble map.
 * Cross-references against live graph data to preserve node types,
 * colors, links, and cabal connections from the original scan.
 */
export function snapshotToGraphData(
  snapshot: HistoricalSnapshot,
  tokenMint: string,
  tokenName?: string,
  liveData?: GraphData | null,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  const truncate = (addr: string) =>
    addr.length > 8 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;

  // Build lookup from live data for node types, colors, metadata, and links
  const liveNodeMap = new Map<string, GraphNode>();
  const liveLinkSet = new Set<string>();
  const liveFunderNodes = new Map<string, GraphNode>();

  if (liveData) {
    for (const node of liveData.nodes) {
      liveNodeMap.set(node.id, node);
      if (node.type === 'cabal-funder' || node.type === 'funder') {
        liveFunderNodes.set(node.id, node);
      }
    }
    for (const link of liveData.links) {
      const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
      const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
      liveLinkSet.add(`${src}->${tgt}`);
    }
  }

  // Historical holder addresses
  const snapshotHolderSet = new Set(snapshot.holders.map(h => h.address));

  // Central token node
  const liveTokenNode = liveNodeMap.get(tokenMint);
  nodes.push({
    id: tokenMint,
    label: tokenName || liveTokenNode?.label || truncate(tokenMint),
    val: 30,
    color: NODE_COLORS.token,
    type: 'token',
    depth: 0,
    expanded: false,
    metadata: liveTokenNode?.metadata,
  });

  // Holder nodes — use live node type/color if available
  for (const holder of snapshot.holders) {
    const liveNode = liveNodeMap.get(holder.address);
    const sizeBase = Math.max(3, Math.sqrt(holder.pctSupply) * 4);

    nodes.push({
      id: holder.address,
      label: liveNode?.label || truncate(holder.address),
      val: sizeBase,
      color: liveNode?.color || NODE_COLORS.holder,
      type: liveNode?.type || 'holder',
      depth: liveNode?.depth ?? 1,
      tokenAmount: holder.balance,
      expanded: false,
      metadata: liveNode?.metadata,
      identity: liveNode?.identity,
      fundingSource: liveNode?.fundingSource,
    });
  }

  // Add funder nodes that connect to holders in this snapshot
  for (const [funderAddr, funderNode] of liveFunderNodes) {
    if (snapshotHolderSet.has(funderAddr)) continue; // Already added as holder
    if (nodes.some(n => n.id === funderAddr)) continue;

    // Check if this funder connects to any holder in the snapshot
    const connectsToSnapshot = liveData?.links.some(link => {
      const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
      const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
      return (src === funderAddr && snapshotHolderSet.has(tgt)) ||
             (tgt === funderAddr && snapshotHolderSet.has(src));
    });

    if (connectsToSnapshot) {
      nodes.push({
        ...funderNode,
        val: Math.max(3, (funderNode.val || 5) * 0.7),
      });
    }
  }

  // Build node set for link filtering
  const nodeIdSet = new Set(nodes.map(n => n.id));

  // Preserve live links where both endpoints exist in the snapshot
  if (liveData) {
    for (const link of liveData.links) {
      const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
      const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;

      if (nodeIdSet.has(src) && nodeIdSet.has(tgt)) {
        links.push({
          source: src,
          target: tgt,
          value: link.value,
          txSignature: link.txSignature,
          suspicious: link.suspicious,
        });
      }
    }
  }

  // Add token->holder links for holders not connected via live links
  const linkedHolders = new Set<string>();
  for (const link of links) {
    const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
    const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
    if (tgt !== tokenMint) linkedHolders.add(tgt);
    if (src !== tokenMint) linkedHolders.add(src);
  }

  for (const holder of snapshot.holders) {
    if (!linkedHolders.has(holder.address)) {
      links.push({
        source: tokenMint,
        target: holder.address,
        value: holder.pctSupply,
      });
    }
  }

  return { nodes, links };
}
