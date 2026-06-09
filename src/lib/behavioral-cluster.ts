import { GraphNode } from './types';
import { UnionFind } from './graph-analysis';

// Behavioral clustering catches crews that LAUNDER their funding (no shared funder
// link) but still act as one hand: same buy-slot, same co-buy cohort, similar wallet
// age and position size. It reuses only features holder-mapper actually populates in
// token mode — buy-slot proximity, co-slot peers, funding-age proxy, holding size.

export interface BehavioralFeatures {
  wallet: string;
  buySlotOffset: number;   // blocksAfterLaunch (0 if unknown — non-sniper)
  sameSlotPeers: number;   // # of holders that bought in the SAME slot
  ageDaysProxy: number;    // (now - first-incoming-SOL) in days, from fundingSource.timestamp
  holdingShare: number;    // this wallet's holding / total analyzed holding (0..1)
}

export interface BehavioralCluster {
  clusterId: number;
  wallets: string[];
  cohesion: number;        // 0..100, inverse of avg intra-cluster distance
}

const DEFAULT_EPS = 0.28;
const DEFAULT_MIN_PTS = 2;

export function extractBehavioralFeatures(
  nodes: GraphNode[],
  sameSlotMap: Map<string, number>,
): BehavioralFeatures[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const holdings = nodes.map(n => n.tokenAmount ?? 0);
  const totalHolding = holdings.reduce((a, b) => a + b, 0) || 1;

  return nodes.map(n => ({
    wallet: n.id,
    buySlotOffset: n.metadata?.blocksAfterLaunch ?? 0,
    sameSlotPeers: sameSlotMap.get(n.id) ?? 0,
    ageDaysProxy: n.fundingSource?.timestamp ? (nowSec - n.fundingSource.timestamp) / 86400 : -1,
    holdingShare: (n.tokenAmount ?? 0) / totalHolding,
  }));
}

// Normalize each dimension to 0..1 across the holder set so the weighted distance
// is scale-free. Returns a normalizer closure.
function buildNormalizer(features: BehavioralFeatures[]) {
  const range = (vals: number[]) => {
    const valid = vals.filter(v => v >= 0);
    if (valid.length === 0) return { min: 0, span: 1 };
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    return { min, span: max - min || 1 };
  };
  const slot = range(features.map(f => f.buySlotOffset));
  const peers = range(features.map(f => f.sameSlotPeers));
  const age = range(features.map(f => f.ageDaysProxy));
  const norm = (v: number, r: { min: number; span: number }) => (v < 0 ? 0.5 : (v - r.min) / r.span);
  return (f: BehavioralFeatures) => ({
    slot: norm(f.buySlotOffset, slot),
    peers: norm(f.sameSlotPeers, peers),
    age: norm(f.ageDaysProxy, age),
    holding: f.holdingShare, // already 0..1
  });
}

// Weighted Euclidean. Co-slot proximity + buy-slot timing dominate — those are the
// signatures of a coordinated hand; age and size are secondary corroboration.
const WEIGHTS = { slot: 0.35, peers: 0.4, age: 0.15, holding: 0.1 };

export function clusterByBehavior(
  features: BehavioralFeatures[],
  opts: { eps?: number; minPts?: number } = {},
): BehavioralCluster[] {
  const eps = opts.eps ?? DEFAULT_EPS;
  const minPts = opts.minPts ?? DEFAULT_MIN_PTS;
  if (features.length < minPts) return [];

  const normalize = buildNormalizer(features);
  const vecs = features.map(normalize);

  const distance = (i: number, j: number): number => {
    const a = vecs[i], b = vecs[j];
    return Math.sqrt(
      WEIGHTS.slot * (a.slot - b.slot) ** 2 +
      WEIGHTS.peers * (a.peers - b.peers) ** 2 +
      WEIGHTS.age * (a.age - b.age) ** 2 +
      WEIGHTS.holding * (a.holding - b.holding) ** 2
    );
  };

  // DBSCAN-style connectivity via union-find: link any pair within eps.
  const uf = new UnionFind();
  const pairDistances: number[] = [];
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const d = distance(i, j);
      if (d < eps) {
        uf.union(features[i].wallet, features[j].wallet);
        pairDistances.push(d);
      }
    }
  }

  // Collect components, drop those below minPts.
  const groups = new Map<string, string[]>();
  for (const f of features) {
    const root = uf.find(f.wallet);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(f.wallet);
  }

  const avgDist = pairDistances.length
    ? pairDistances.reduce((a, b) => a + b, 0) / pairDistances.length
    : eps;
  const cohesion = Math.round(Math.max(0, Math.min(100, (1 - avgDist / eps) * 100)));

  let clusterId = 0;
  const out: BehavioralCluster[] = [];
  for (const wallets of groups.values()) {
    if (wallets.length < minPts) continue;
    out.push({ clusterId: clusterId++, wallets, cohesion });
  }
  return out;
}
