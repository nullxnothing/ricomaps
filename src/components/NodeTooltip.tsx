'use client';

import { GraphNode } from '@/lib/types';

interface NodeTooltipProps {
  node: GraphNode | null;
  position: { x: number; y: number } | null;
}

function formatAmount(amount: number): string {
  if (amount >= 1e9) return (amount / 1e9).toFixed(2) + 'B';
  if (amount >= 1e6) return (amount / 1e6).toFixed(2) + 'M';
  if (amount >= 1e3) return (amount / 1e3).toFixed(2) + 'K';
  return amount.toFixed(4);
}

export function NodeTooltip({ node, position }: NodeTooltipProps) {
  if (!node || !position) return null;

  const typeLabels: Record<string, string> = {
    target: 'Target Wallet',
    funder: 'Funder',
    funded: 'Funded',
    holder: 'Token Holder',
    token: 'Token',
    'cabal-funder': 'CABAL Funder',
    connected: 'Connected',
  };

  return (
    <div
      className="tooltip"
      style={{
        left: position.x + 10,
        top: position.y + 10,
        transform: 'translate(0, -50%)',
      }}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: node.color }}
          />
          <span className="text-xs text-[#888]">{typeLabels[node.type] || node.type}</span>
        </div>
        <div className="font-mono text-[10px] text-[#00ff9f] break-all">
          {node.id}
        </div>
        {node.solBalance !== undefined && (
          <div className="text-xs">
            <span className="text-[#888]">Balance: </span>
            <span className="text-[#00d4ff]">{formatAmount(node.solBalance)} SOL</span>
          </div>
        )}
        {node.tokenAmount !== undefined && (
          <div className="text-xs">
            <span className="text-[#888]">Holding: </span>
            <span className="text-[#00d4ff]">{formatAmount(node.tokenAmount)}</span>
          </div>
        )}
        {node.metadata?.suspicious && (
          <div className="badge-danger inline-block mt-1">SUSPICIOUS</div>
        )}
        {node.metadata?.fundedCount && node.metadata.fundedCount > 1 && (
          <div className="text-xs text-[#ff3366]">
            Funded {node.metadata.fundedCount} holders
          </div>
        )}
        {!node.expanded && node.type !== 'token' && (
          <div className="text-xs text-[#666] mt-1 italic">
            Click to expand
          </div>
        )}
      </div>
    </div>
  );
}

export default NodeTooltip;
