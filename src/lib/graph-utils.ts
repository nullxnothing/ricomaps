import { GraphNode, NODE_COLORS } from './types';
import { truncateAddress } from './address-utils';
import { getWalletLabel } from './wallet-labels';

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

  return {
    id: address,
    label: label ? label.name : truncateAddress(address),
    val: Math.max(5, Math.log10((amount || 1) + 1) * 10),
    color: NODE_COLORS[type] || NODE_COLORS.default,
    type,
    depth,
    tokenAmount: type === 'holder' || type === 'token' ? amount : undefined,
    solBalance: type !== 'holder' && type !== 'token' ? amount : undefined,
    expanded: false,
    walletLabel,
    metadata: metadata || { fundedBy: [], funded: [] },
  };
}
