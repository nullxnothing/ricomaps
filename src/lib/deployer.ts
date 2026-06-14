import { DeployerInfo, GraphNode, SupplyConcentration, HeliusAsset } from './types';
import { GtfaTransaction, getMintTxSigner } from './helius';
import { shouldFilterAddress } from './address-utils';

const SERIAL_THRESHOLD = 3;

interface ResolvedDeployer {
  address: string;
  source: DeployerInfo['source'];
  /** Program/PDA creator: skip launch-history lookup (would return garbage). */
  unattributable: boolean;
  notes: string[];
}

/**
 * Resolve the true deployer of a token. Zero API calls, uses already-fetched data.
 *
 * Primary signal is the fee payer of the first mint tx (the human dev). The DAS
 * creator/update-authority is preferred only as a fallback because on pump.fun
 * it is usually the pump program/PDA, not the dev.
 */
export function extractDeployer(
  mintEarlyTxs: GtfaTransaction[],
  asset: HeliusAsset | null,
): ResolvedDeployer | null {
  const notes: string[] = [];

  const signer = mintEarlyTxs.length > 0 ? getMintTxSigner(mintEarlyTxs[0]) : '';
  if (signer && !shouldFilterAddress(signer)) {
    return { address: signer, source: 'mint-tx-signer', unattributable: false, notes };
  }

  // Signer missing or itself a program, fall back to DAS metadata.
  if (signer && shouldFilterAddress(signer)) {
    notes.push('Mint tx signer is a program, using creator metadata.');
  }

  const creator = asset?.creators?.find(c => c.share > 0)?.address;
  if (creator) {
    const unattributable = shouldFilterAddress(creator);
    if (unattributable) notes.push('Creator is the pump.fun program: true dev not attributable on-chain.');
    return { address: creator, source: 'creator', unattributable, notes };
  }

  const authority = asset?.authorities?.[0]?.address;
  if (authority) {
    const unattributable = shouldFilterAddress(authority);
    if (unattributable) notes.push('Update authority is a program: true dev not attributable.');
    return { address: authority, source: 'update-authority', unattributable, notes };
  }

  return null;
}

/**
 * Coverage-aware "does the dev still hold" check. Zero API calls.
 * Absence from the analyzed top-N is UNKNOWN (null), not "dumped"; the dev may
 * hold below the visibility cutoff.
 */
export function computeDeployerHoldings(
  deployer: string,
  holderNodes: GraphNode[],
  supply: SupplyConcentration,
): Pick<DeployerInfo, 'stillHolds' | 'heldSupplyPct' | 'inAnalyzedSet'> & { note?: string } {
  const node = holderNodes.find(n => n.id === deployer);
  if (node) {
    const amount = node.tokenAmount ?? 0;
    const heldSupplyPct = supply.circulatingSupplyUsed > 0
      ? round1((amount / supply.circulatingSupplyUsed) * 100)
      : 0;
    return { stillHolds: amount > 0, heldSupplyPct, inAnalyzedSet: true };
  }

  return {
    stillHolds: null,
    heldSupplyPct: null,
    inAnalyzedSet: false,
    note: `Dev not in top holders: may hold below the visibility cutoff (coverage ${supply.analyzedSupplyPct.toFixed(0)}%).`,
  };
}

/** Assemble the final DeployerInfo from resolved parts. */
export function buildDeployerInfo(args: {
  resolved: ResolvedDeployer;
  holdings: ReturnType<typeof computeDeployerHoldings>;
  pastLaunchCount: number | null;
  fundedBy: DeployerInfo['fundedBy'];
  priorRugCount?: number;       // from the persistent wallet-reputation store
}): DeployerInfo {
  const { resolved, holdings, pastLaunchCount, fundedBy, priorRugCount = 0 } = args;
  const notes = [...resolved.notes];
  if (holdings.note) notes.push(holdings.note);
  // pump.fun deployers are rarely the on-chain DAS creator, so a 0 count is a
  // floor, not proof of a first-timer. Be explicit rather than imply safety.
  if (resolved.source === 'mint-tx-signer' && pastLaunchCount === 0) {
    notes.push('No prior launches found via on-chain creator records (may undercount pump.fun devs).');
  }
  if (priorRugCount > 0) {
    notes.push(`⛔ This dev has rugged ${priorRugCount} prior token${priorRugCount === 1 ? '' : 's'} we've tracked.`);
  }

  return {
    address: resolved.address,
    source: resolved.source,
    stillHolds: holdings.stillHolds,
    heldSupplyPct: holdings.heldSupplyPct,
    inAnalyzedSet: holdings.inAnalyzedSet,
    pastLaunchCount,
    isSerialDeployer: pastLaunchCount !== null && pastLaunchCount > SERIAL_THRESHOLD,
    priorRugCount,
    isRugDev: priorRugCount > 0,
    fundedBy,
    notes,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
