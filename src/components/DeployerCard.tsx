'use client';

import { DeployerInfo } from '@/lib/types';
import { truncateAddress } from '@/lib/address-utils';

interface DeployerCardProps {
  deployer: DeployerInfo | null;
}

export function DeployerCard({ deployer }: DeployerCardProps) {
  if (!deployer) return null;

  const holds = holdStatus(deployer);

  return (
    <div className="mt-3 pt-3 border-t border-border-base">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-text-secondary">Deployer</span>
        <a
          href={`https://solscan.io/account/${deployer.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-text-tertiary hover:text-green-primary transition-colors"
          title={deployer.address}
        >
          {truncateAddress(deployer.address)} ↗
        </a>
      </div>

      <div className="space-y-0">
        <div className="stats-item">
          <span className="stats-label">Dev holds</span>
          <span className="stats-value" style={{ color: holds.color }}>{holds.text}</span>
        </div>

        <div className="stats-item">
          <span className="stats-label">Past launches</span>
          <span className="stats-value">
            {deployer.pastLaunchCount === null ? (
              <span className="text-text-tertiary">unknown</span>
            ) : (
              <>
                {deployer.pastLaunchCount}
                {deployer.isSerialDeployer && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase"
                    style={{ color: 'var(--red-primary)', background: 'var(--red-ghost)' }}>
                    Serial
                  </span>
                )}
              </>
            )}
          </span>
        </div>

        {deployer.fundedBy && (
          <div className="stats-item">
            <span className="stats-label">Funded by</span>
            <span className="stats-value font-mono text-[11px]" title={deployer.fundedBy.address}>
              {deployer.fundedBy.source !== 'UNKNOWN' ? deployer.fundedBy.source : truncateAddress(deployer.fundedBy.address)}
            </span>
          </div>
        )}
      </div>

      {deployer.notes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {deployer.notes.map((note, i) => (
            <li key={i} className="text-[10px] leading-tight text-text-tertiary">• {note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function holdStatus(d: DeployerInfo): { text: string; color: string } {
  if (d.stillHolds === null) {
    return { text: 'Unknown (outside coverage)', color: 'var(--text-tertiary)' };
  }
  if (d.stillHolds && d.heldSupplyPct !== null) {
    const high = d.heldSupplyPct >= 5;
    return {
      text: `Holds ${d.heldSupplyPct.toFixed(1)}%`,
      color: high ? 'var(--amber-primary)' : 'var(--green-primary)',
    };
  }
  return { text: 'Dumped (0% in view)', color: 'var(--red-primary)' };
}

export default DeployerCard;
