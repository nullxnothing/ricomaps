import { GraphNode, NODE_COLORS } from './types';
import { truncateAddress } from './address-utils';
import { getWalletLabel } from './wallet-labels';

// Node roles that represent a token holder (carry a token balance, not SOL).
const HOLDER_ROLE_TYPES = new Set<GraphNode['type']>([
  'holder', 'token', 'sniper', 'bundled', 'pool', 'connected',
]);

export function createNode(
  address: string,
  depth: number,
  type: GraphNode['type'],
  amount?: number,
  metadata?: GraphNode['metadata']
): GraphNode {
  const label = getWalletLabel(address);
  const walletLabel = label ? {
    name: label.name,
    category: label.category,
    verified: label.verified,
    risk: label.risk,
  } : undefined;

  // Holder-role nodes carry a token balance; funder-side nodes carry a SOL balance.
  const isTokenBalanceNode = HOLDER_ROLE_TYPES.has(type);

  return {
    id: address,
    label: label ? label.name : truncateAddress(address),
    val: Math.max(5, Math.log10((amount || 1) + 1) * 10),
    color: NODE_COLORS[type] || NODE_COLORS.default,
    type,
    depth,
    tokenAmount: isTokenBalanceNode ? amount : undefined,
    solBalance: isTokenBalanceNode ? undefined : amount,
    expanded: false,
    walletLabel,
    metadata: metadata || { fundedBy: [], funded: [] },
  };
}
