'use client';

import { useRef, useEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide, SimulationNodeDatum, SimulationLinkDatum, Simulation } from 'd3-force';
import { GraphData, GraphNode, GraphLink, NODE_COLORS, NodeType } from '@/lib/types';
import { truncateAddress } from '@/lib/address-utils';

export type BubbleMapFilter = 'cabal' | 'snipers' | 'bundles' | 'behavioral' | null;
export type BubbleRenderMode = 'default' | 'heatmap' | 'cluster';

/** Imperative surface driven by the external control dock. */
export interface BubbleMapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  exportPng: () => void;
  exportCsv: () => void;
  /** Spawn a Go-Live pulse ring on a random holder (called per live event). */
  pulseRandom: () => void;
}

interface BubbleMapProps {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  onTraceFunders?: (node: GraphNode) => void;
  filter?: BubbleMapFilter;
  /** Render mode driven by the dock (default colors / risk heatmap / cluster hulls). */
  mode?: BubbleRenderMode;
  /** Reports the current zoom level (0–1 scale → %) so the dock can display it. */
  onZoomChange?: (pct: number) => void;
  /** Full on-chain mint supply (pool included) for honest per-bubble %. Falls back to top-N sum if absent. */
  totalSupply?: number;
}

interface BubbleNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: GraphNode['type'];
  radius: number;
  supplyPct: number;
  clusterId: number;
  /** Bundle/crew home anchor — nodes gravitate here so bundles form islands. */
  homeX: number;
  homeY: number;
  /** True once a drag pins this node in place (persists until double-click). */
  pinned?: boolean;
  originalNode: GraphNode;
}

interface BubbleLink extends SimulationLinkDatum<BubbleNode> {
  suspicious: boolean;
}

interface TooltipData {
  node: BubbleNode;
  x: number;
  y: number;
}

// Bundle/crew palette (spec): each funded crew = one color, cabal hub pink.
const CLUSTER_COLORS = [
  '#a78bfa', '#60a5fa', '#22d3ee', '#2dd4bf', '#f472b6',
  '#34d399', '#facc15', '#f59e0b', '#a78bfa', '#60a5fa',
];

const UNLINKED_COLOR = '#00FF41'; // lone (unconnected) holder → brand green
const POOL_COLOR = '#9aa3b2';
const TOKEN_COLOR = '#00FF41';

// Semantic node color by type; falls back to cluster color for generic types.
function getNodeColor(type: NodeType, clusterId: number): string {
  if (type === 'pool') return POOL_COLOR;
  if (type === 'token') return TOKEN_COLOR;
  if (type === 'sniper') return '#22d3ee';
  if (type === 'bundled') return clusterId >= 0 ? CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length] : '#a78bfa';
  if (type === 'cabal-funder') return '#f472b6';
  if (clusterId >= 0) return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
  return UNLINKED_COLOR;
}

// Heatmap recolor: lower risk = greener. Mirrors the prototype thresholds.
function heatColor(node: BubbleNode): string {
  const t = node.originalNode.type;
  if (t === 'bundled') return '#ef4444';
  if (t === 'sniper') return '#f59e0b';
  if (t === 'pool') return POOL_COLOR;
  if (t === 'funder' || t === 'cabal-funder') return '#60a5fa';
  const pct = node.supplyPct;
  if (pct > 4.5) return '#f59e0b';
  if (pct > 3.6) return '#facc15';
  return '#00FF41';
}

// "#rrggbb" + alpha → rgba()
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function rgbStr(hex: string): string {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}
// Quadratic bézier point at parameter t.
function qpt(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number) {
  const u = 1 - t;
  return { x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1 };
}

function computeSupplyPct(node: GraphNode, totalSupply: number): number {
  const amount = node.tokenAmount || node.solBalance || node.val || 0;
  if (totalSupply <= 0) return 0;
  return (amount / totalSupply) * 100;
}

/**
 * Denominator for per-bubble supply %. Each bubble shows its share of the FULL
 * on-chain mint supply (pool included), so the pool bubble reads ~30% and real
 * holders read their true 3-5% — matching Trench/Axiom. Falling back to the sum
 * of rendered top-N holders inflates every %: the top ~20 cover only a fraction
 * of supply, so 3% real reads as ~10%.
 */
function resolveSupplyDenominator(totalSupply: number | undefined, holders: GraphNode[]): number {
  if (totalSupply && totalSupply > 0) return totalSupply;
  return holders.reduce((sum, n) => sum + (n.tokenAmount || n.solBalance || 0), 0);
}

const MIN_RADIUS = 6;
const MAX_RADIUS = 45;

// Bubble radius from a holder's amount, scaled against the largest holder (sqrt = area-proportional).
function computeRadius(amount: number, maxAmount: number): number {
  const ratio = Math.sqrt(Math.max(0, amount) / Math.max(maxAmount, 1));
  return MIN_RADIUS + ratio * (MAX_RADIUS - MIN_RADIUS);
}

function assignClusters(nodes: GraphNode[], links: GraphLink[]): Map<string, number> {
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const node of nodes) parent.set(node.id, node.id);
  for (const link of links) {
    const src = typeof link.source === 'string' ? link.source : (link.source as BubbleNode).id;
    const tgt = typeof link.target === 'string' ? link.target : (link.target as BubbleNode).id;
    union(src, tgt);
  }

  const rootToCluster = new Map<string, number>();
  let nextId = 0;
  const result = new Map<string, number>();

  for (const node of nodes) {
    const root = find(node.id);
    if (!rootToCluster.has(root)) {
      rootToCluster.set(root, nextId++);
    }
    result.set(node.id, rootToCluster.get(root)!);
  }

  const clusterSizes = new Map<number, number>();
  for (const [, cid] of result) {
    clusterSizes.set(cid, (clusterSizes.get(cid) || 0) + 1);
  }
  for (const [nodeId, cid] of result) {
    if ((clusterSizes.get(cid) || 0) <= 1) {
      result.set(nodeId, -1);
    }
  }

  return result;
}

// Spread each bundle's home anchor around a ring so bundles form separate islands;
// lone holders get their own scattered homes, the token sits at the origin. Returns
// a per-node {hx,hy} the physics pulls toward (spec: home-anchored clumping).
// Golden-angle (sunflower) point: even, organic, non-ring spread. Deterministic
// in `index`, so positions are stable across renders (no Math.random — it would
// jitter every frame and is unavailable in this runtime anyway).
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
function sunflower(index: number, cx: number, cy: number, spread: number): { hx: number; hy: number } {
  const r = spread * Math.sqrt(index + 0.5);
  const ang = index * GOLDEN_ANGLE;
  return { hx: cx + Math.cos(ang) * r, hy: cy + Math.sin(ang) * r };
}

function computeHomes(
  nodes: { id: string; type: NodeType; clusterId: number }[],
  width: number,
  height: number,
): Map<string, { hx: number; hy: number }> {
  const homes = new Map<string, { hx: number; hy: number }>();
  const cx = width / 2;
  const cy = height / 2;
  const base = Math.min(width, height);

  // Each cluster (crew) and each lone holder gets its OWN scattered anchor, placed
  // on a shared sunflower spiral so they fill the canvas as separate islands
  // instead of all sitting on a ring. The link + collide forces then pull a crew's
  // members tightly around their funder hub (the star-bursts in the spec).
  const clusterIds = Array.from(new Set(nodes.filter(n => n.clusterId >= 0).map(n => n.clusterId))).sort((a, b) => a - b);
  const loneNodes = nodes.filter(n => n.clusterId < 0 && n.type !== 'token' && n.type !== 'pool');

  // One spiral slot per island (cluster or lone holder). Spacing scales so a
  // crowded map spreads wider. Skip the first few slots so nothing lands on the
  // centered token.
  const islandCount = clusterIds.length + loneNodes.length;
  const spread = (base * 0.5) / Math.sqrt(Math.max(islandCount, 1) + 4);
  const SKIP = 3; // reserve the dense center for the token

  const clusterHome = new Map<number, { hx: number; hy: number }>();
  clusterIds.forEach((cid, i) => clusterHome.set(cid, sunflower(SKIP + i, cx, cy, spread)));

  const loneHome = new Map<string, { hx: number; hy: number }>();
  loneNodes.forEach((n, i) => loneHome.set(n.id, sunflower(SKIP + clusterIds.length + i, cx, cy, spread)));

  for (const n of nodes) {
    if (n.type === 'token') { homes.set(n.id, { hx: cx, hy: cy }); continue; }
    if (n.type === 'pool') { homes.set(n.id, { hx: cx - base * 0.34, hy: cy - base * 0.16 }); continue; }
    if (n.clusterId >= 0) {
      homes.set(n.id, clusterHome.get(n.clusterId)!);
    } else {
      homes.set(n.id, loneHome.get(n.id) ?? { hx: cx, hy: cy });
    }
  }
  return homes;
}

export const BubbleMap = forwardRef<BubbleMapHandle, BubbleMapProps>(function BubbleMap(
  { data, onNodeClick, onTraceFunders, filter = null, mode = 'default', onZoomChange, totalSupply: totalSupplyProp },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<BubbleNode[]>([]);
  const linksRef = useRef<BubbleLink[]>([]);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{
    isDragging: boolean;
    isPanning: boolean;
    startX: number;
    startY: number;
    draggedNode: BubbleNode | null;
  }>({ isDragging: false, isPanning: false, startX: 0, startY: 0, draggedNode: null });
  const hoveredNodeRef = useRef<BubbleNode | null>(null);
  const animRef = useRef<number>(0);
  const simRef = useRef<Simulation<BubbleNode, BubbleLink> | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const dprRef = useRef(1);
  // 3 particles per edge, each at a different position along the path
  const particlesRef = useRef<Map<string, { t: number }[]>>(new Map());
  const lastFrameTimeRef = useRef(0);
  // Track data identity to avoid restarting sim on poll updates
  const prevNodeCountRef = useRef(0);
  const dataVersionRef = useRef(0);

  // Imperative handles read by event/keyboard handlers (set inside the sim effect).
  const autoFitRef = useRef<(() => void) | null>(null);
  // A node id to flash a ring around (find result), with an expiry timestamp.
  const highlightRef = useRef<{ id: string; until: number } | null>(null);
  // Node ids hidden via the context menu, skipped in the draw loop.
  const hiddenIdsRef = useRef<Set<string>>(new Set());
  // Radius scale (largest holder amount) fixed at scan time, so live balance updates
  // resize one bubble relative to the original scale instead of rescaling the whole graph.
  const maxAmountRef = useRef(1);

  // Tooltip is the only piece of React state; it drives the overlay DOM
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  // Render mode (default | heatmap | cluster) is driven by the external dock.
  const modeRef = useRef<BubbleRenderMode>('default');
  modeRef.current = mode;
  const filterRef = useRef<BubbleMapFilter>(null);
  filterRef.current = filter;
  // Go-Live pulse rings: expanding rings spawned on holders per live event.
  const pulsesRef = useRef<{ id: string; life: number }[]>([]);
  // Throttle zoom-% reporting to React to avoid per-frame setState churn.
  const lastZoomPctRef = useRef(-1);
  const reportZoom = useCallback(() => {
    if (!onZoomChange) return;
    const pct = Math.round(transformRef.current.k * 100);
    if (pct !== lastZoomPctRef.current) {
      lastZoomPctRef.current = pct;
      onZoomChange(pct);
    }
  }, [onZoomChange]);

  // Context menu state (rare user-driven event, so plain state is fine).
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: BubbleNode } | null>(null);

  // Summary for screen readers; recomputes only when graph changes
  const ariaSummary = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const cabalCount = nodes.filter(n => n.type === 'cabal-funder').length;
    const sniperCount = nodes.filter(n => n.metadata?.isSniper).length;
    const tokenCount = nodes.filter(n => n.type === 'token').length;
    const parts = [
      `Network graph with ${nodes.length} nodes and ${data?.links?.length ?? 0} connections`,
    ];
    if (cabalCount) parts.push(`${cabalCount} cabal funder${cabalCount === 1 ? '' : 's'}`);
    if (sniperCount) parts.push(`${sniperCount} sniper${sniperCount === 1 ? '' : 's'}`);
    if (tokenCount) parts.push(`${tokenCount} token${tokenCount === 1 ? '' : 's'}`);
    return parts.join(', ');
  }, [data]);

  // Convert screen (CSS) coords to world coords
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const t = transformRef.current;
    return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
  }, []);

  // Hit-test nodes (reverse order = top-most drawn last)
  const findNodeAt = useCallback((wx: number, wy: number): BubbleNode | null => {
    const nodes = nodesRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.x == null || n.y == null) continue;
      const dx = wx - n.x, dy = wy - n.y;
      if (dx * dx + dy * dy < n.radius * n.radius) return n;
    }
    return null;
  }, []);

  // Detect full scan vs incremental live update by node-set overlap, not raw count.
  // A new scan replaces the dataset (little overlap with the previous nodes); live
  // deltas add/remove a few nodes (high overlap) and must stay incremental so the
  // graph doesn't relayout under the user on every buy.
  const prevNodeIdsRef = useRef<Set<string>>(new Set());
  const nodeCount = data?.nodes.length || 0;
  const prevCount = prevNodeCountRef.current;
  let isNewScan: boolean;
  if (prevCount === 0 || nodeCount === 0) {
    isNewScan = true;
  } else {
    const prevSet = prevNodeIdsRef.current;
    const currentIds = data!.nodes.map(n => n.id);
    const overlap = currentIds.filter(id => prevSet.has(id)).length;
    // <50% of the previous graph survived → treat as a new scan (full rebuild).
    isNewScan = overlap < prevCount * 0.5;
  }
  if (nodeCount > 0) {
    prevNodeCountRef.current = nodeCount;
    prevNodeIdsRef.current = new Set(data!.nodes.map(n => n.id));
  }
  if (isNewScan) {
    dataVersionRef.current++;
  }
  const dataVersion = dataVersionRef.current;

  // Incremental live update: handles streaming deltas without rebuilding the graph:
  //   • existing node balance changed → update radius + supplyPct
  //   • new buyer in data           → add a bubble node (+ its links), gently reheat
  //   • holder removed (sold to 0)   → drop node, its links, and particles
  // A full rebuild only happens on a new scan (isNewScan, handled by the sim effect).
  useEffect(() => {
    if (!data || isNewScan || nodesRef.current.length === 0) return;
    const sim = simRef.current;

    const dataNodeMap = new Map(data.nodes.map(n => [n.id, n]));
    const holders = data.nodes.filter(n => n.type !== 'token');
    const totalSupply = resolveSupplyDenominator(totalSupplyProp, holders);
    // Reuse the scan-time scale so live updates don't rescale every bubble. Only grow it
    // if a holder genuinely exceeds the current max (never shrink; that's what caused the
    // "all bubbles get smaller" flicker when streaming started).
    const liveMax = Math.max(...holders.map(n => n.tokenAmount || n.solBalance || 0), 1);
    const maxAmount = Math.max(maxAmountRef.current, liveMax);
    maxAmountRef.current = maxAmount;
    const clusterMap = assignClusters(data.nodes, data.links);
    const { width, height } = sizeRef.current;

    // 1. Update existing nodes in place; radius now tracks live balance changes.
    for (const node of nodesRef.current) {
      const updated = dataNodeMap.get(node.id);
      if (!updated) continue;
      node.originalNode = updated;
      node.supplyPct = computeSupplyPct(updated, totalSupply);
      node.radius = computeRadius(updated.tokenAmount || updated.solBalance || 0, maxAmount);
      node.clusterId = clusterMap.get(node.id) ?? -1;
    }

    // 2. Add new buyers as fresh bubbles near center, so they fly in and settle.
    const existingIds = new Set(nodesRef.current.map(n => n.id));
    const liveHomes = computeHomes(
      data.nodes.map(n => ({ id: n.id, type: n.type, clusterId: clusterMap.get(n.id) ?? -1 })),
      width || 800,
      height || 600,
    );
    let added = 0;
    for (const node of data.nodes) {
      if (node.type === 'token' || existingIds.has(node.id)) continue;
      const amount = node.tokenAmount || node.solBalance || 0;
      const home = liveHomes.get(node.id) ?? { hx: (width || 800) / 2, hy: (height || 600) / 2 };
      nodesRef.current.push({
        id: node.id,
        label: node.label,
        type: node.type,
        radius: computeRadius(amount, maxAmount),
        supplyPct: computeSupplyPct(node, totalSupply),
        clusterId: clusterMap.get(node.id) ?? -1,
        homeX: home.hx,
        homeY: home.hy,
        originalNode: node,
        x: home.hx + (Math.random() - 0.5) * 60,
        y: home.hy + (Math.random() - 0.5) * 60,
      });
      added++;
    }

    // 3. Drop holders that sold to zero (removed from data).
    const dataIds = new Set(data.nodes.map(n => n.id));
    const before = nodesRef.current.length;
    nodesRef.current = nodesRef.current.filter(n => dataIds.has(n.id));
    const removed = before - nodesRef.current.length;

    // 4. Rebuild links against the current node set (covers both adds and removals).
    const nodeIds = new Set(nodesRef.current.map(n => n.id));
    const endpoints = (l: GraphLink) => {
      const s = typeof l.source === 'string' ? l.source : (l.source as unknown as { id: string }).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as unknown as { id: string }).id;
      return { s, t };
    };
    linksRef.current = data.links.reduce<BubbleLink[]>((acc, l) => {
      const { s, t } = endpoints(l);
      if (nodeIds.has(s) && nodeIds.has(t)) {
        acc.push({ source: s, target: t, suspicious: l.suspicious || false });
      }
      return acc;
    }, []);

    if (sim) {
      sim.nodes(nodesRef.current);
      const linkForce = sim.force('link') as ReturnType<typeof forceLink<BubbleNode, BubbleLink>> | undefined;
      linkForce?.links(linksRef.current);
      // Seed particles for any new links.
      for (const l of linksRef.current) {
        const key = `${(l.source as BubbleNode).id ?? l.source}-${(l.target as BubbleNode).id ?? l.target}`;
        if (!particlesRef.current.has(key)) {
          particlesRef.current.set(key, [{ t: 0 }, { t: 0.33 }, { t: 0.66 }]);
        }
      }
      // Gentle reheat only when the graph structure changed, so new bubbles settle.
      if (added > 0 || removed > 0) {
        sim.alpha(Math.min(0.3, sim.alpha() + 0.2)).restart();
      }
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Simulation + render loop (only on new scan, not poll updates) ──
  useEffect(() => {
    if (!data || data.nodes.length === 0 || !canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    // ── Size canvas with DPR ──
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const w = container.clientWidth;
      const h = container.clientHeight;
      sizeRef.current = { width: w, height: h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      // Reset transform each resize; ctx.scale compounds otherwise
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    const width = sizeRef.current.width;
    const height = sizeRef.current.height;

    // ── Build node/link data ──
    const holders = data.nodes.filter(n => n.type !== 'token');
    const totalSupply = resolveSupplyDenominator(totalSupplyProp, holders);
    const clusterMap = assignClusters(data.nodes, data.links);

    const maxAmount = Math.max(...holders.map(n => n.tokenAmount || n.solBalance || 0), 1);
    maxAmountRef.current = maxAmount; // fix the radius scale for the duration of this scan

    // Token node is rendered (center anchor) so beams converge on it visually.
    const includedNodes = data.nodes;
    const homes = computeHomes(
      includedNodes.map(n => ({ id: n.id, type: n.type, clusterId: clusterMap.get(n.id) ?? -1 })),
      width,
      height,
    );

    const bubbleNodes: BubbleNode[] = includedNodes.map(node => {
      const amount = node.tokenAmount || node.solBalance || 0;
      const radius = node.type === 'token' ? 30 : node.type === 'pool' ? 46 : computeRadius(amount, maxAmount);
      const home = homes.get(node.id) ?? { hx: width / 2, hy: height / 2 };
      return {
        id: node.id,
        label: node.label,
        type: node.type,
        radius,
        supplyPct: computeSupplyPct(node, totalSupply),
        clusterId: clusterMap.get(node.id) ?? -1,
        homeX: home.hx,
        homeY: home.hy,
        originalNode: node,
        // Token pinned at center; everything else seeds near its bundle home.
        x: node.type === 'token' ? width / 2 : home.hx + (Math.random() - 0.5) * 80,
        y: node.type === 'token' ? height / 2 : home.hy + (Math.random() - 0.5) * 80,
        fx: node.type === 'token' ? width / 2 : undefined,
        fy: node.type === 'token' ? height / 2 : undefined,
        pinned: node.type === 'token',
      };
    });

    const nodeIds = new Set(bubbleNodes.map(n => n.id));
    const bubbleLinks: BubbleLink[] = data.links
      .filter(l => {
        const src = typeof l.source === 'string' ? l.source : (l.source as unknown as { id: string }).id;
        const tgt = typeof l.target === 'string' ? l.target : (l.target as unknown as { id: string }).id;
        return nodeIds.has(src) && nodeIds.has(tgt);
      })
      .map(l => ({
        source: typeof l.source === 'string' ? l.source : (l.source as unknown as { id: string }).id,
        target: typeof l.target === 'string' ? l.target : (l.target as unknown as { id: string }).id,
        suspicious: l.suspicious || false,
      }));

    nodesRef.current = bubbleNodes;
    linksRef.current = bubbleLinks;

    // Initialize 3 particles per edge, evenly spaced
    const particles = new Map<string, { t: number }[]>();
    for (const link of bubbleLinks) {
      const src = typeof link.source === 'string' ? link.source : (link.source as BubbleNode).id;
      const tgt = typeof link.target === 'string' ? link.target : (link.target as BubbleNode).id;
      const key = `${src}-${tgt}`;
      particles.set(key, [{ t: 0 }, { t: 0.33 }, { t: 0.66 }]);
    }
    particlesRef.current = particles;
    lastFrameTimeRef.current = 0;

    // ── Force simulation: home-anchored islands (spec physics) ──
    // Each node is pulled toward its bundle/crew home (forceX/forceY); gentle charge
    // separates members within a bundle while collide keeps them clumped, and the
    // link springs hold funder→funded ties together. Token home gravity is stronger.
    const sim = forceSimulation(bubbleNodes)
      .force('link', forceLink<BubbleNode, BubbleLink>(bubbleLinks)
        .id(d => d.id)
        .distance(d => {
          const src = d.source as BubbleNode;
          const tgt = d.target as BubbleNode;
          // Crew spokes (funder→funded) sit tight; token spokes longer so the
          // hub fans out from the center.
          const tokenSpoke = src.type === 'token' || tgt.type === 'token';
          return src.radius + tgt.radius + (tokenSpoke ? 60 : 10);
        })
        .strength(d => {
          const src = d.source as BubbleNode;
          const tgt = d.target as BubbleNode;
          return (src.type === 'token' || tgt.type === 'token') ? 0.05 : 0.8;
        })
      )
      // Light charge keeps members from overlapping but doesn't blow bundles apart.
      .force('charge', forceManyBody().strength(-18).distanceMax(160))
      // Strong home gravity = tight islands clumped at their anchor.
      .force('homeX', forceX<BubbleNode>(d => d.homeX).strength(d => (d.type === 'token' ? 0.6 : 0.18)))
      .force('homeY', forceY<BubbleNode>(d => d.homeY).strength(d => (d.type === 'token' ? 0.6 : 0.18)))
      .force('collide', forceCollide<BubbleNode>().radius(d => d.radius + 3).strength(0.9).iterations(2))
      .alphaDecay(0.035)
      .velocityDecay(0.42);

    // Pre-warm the layout synchronously (no paint) so the graph appears already
    // settled instead of visibly churning for ~1.5s on load. Cheap: a few dozen
    // ticks up front beats animating every frame of the settling process.
    sim.stop();
    const WARMUP_TICKS = bubbleNodes.length > 120 ? 60 : 120;
    sim.tick(WARMUP_TICKS);
    sim.restart();

    simRef.current = sim;

    // Fit the viewport to the current node bounds.
    function autoFit() {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const node of bubbleNodes) {
        if (node.x == null || node.y == null) continue;
        const r = node.radius;
        minX = Math.min(minX, node.x - r);
        maxX = Math.max(maxX, node.x + r);
        minY = Math.min(minY, node.y - r);
        maxY = Math.max(maxY, node.y + r);
      }
      const graphW = maxX - minX;
      const graphH = maxY - minY;
      const { width: fw, height: fh } = sizeRef.current;
      if (graphW > 0 && graphH > 0) {
        const padding = 160;
        const scaleX = (fw - padding) / graphW;
        const scaleY = (fh - padding) / graphH;
        const targetK = Math.min(scaleX, scaleY, 1.3);
        const graphCx = (minX + maxX) / 2;
        const graphCy = (minY + maxY) / 2;
        transformRef.current = {
          x: fw / 2 - graphCx * targetK,
          y: fh / 2 - graphCy * targetK,
          k: targetK,
        };
        reportZoom();
      }
    }

    // Layout was pre-warmed, so fit immediately; the graph shows already-arranged.
    autoFit();
    // Expose to the reset button / find centering. Recomputes against live node positions.
    autoFitRef.current = autoFit;

    let tickCount = 0;
    sim.on('tick', () => {
      tickCount++;
      // Re-fit over the first ~30 visible ticks while the pre-warmed layout relaxes
      // the last bit, so the framing stays tight without a late jump.
      if (tickCount <= 30) autoFit();

      // Stop simulation once fully settled
      if (sim.alpha() < 0.001) {
        sim.stop();
      }
    });

    // Helper: get link key for particle lookup
    function linkKey(link: BubbleLink): string {
      const src = link.source as BubbleNode;
      const tgt = link.target as BubbleNode;
      return `${src.id}-${tgt.id}`;
    }

    // ── Render function (reads refs only, no React state) ──
    function draw(timestamp: number) {
      lastFrameTimeRef.current = timestamp;

      const { width: w, height: h } = sizeRef.current;
      const t = transformRef.current;
      const hovered = hoveredNodeRef.current;
      const renderMode = modeRef.current;
      const isHeatmap = renderMode === 'heatmap';
      const isCluster = renderMode === 'cluster';

      // Transparent clear: the page's technical-grid stage shows through the canvas.
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // ── Cluster hulls (cluster mode): dashed translucent blob behind each multi-node cluster ──
      if (isCluster) {
        const agg = new Map<number, BubbleNode[]>();
        for (const node of nodesRef.current) {
          if (node.clusterId < 0 || node.x == null || node.y == null) continue;
          if (node.type === 'token' || node.type === 'pool') continue;
          if (hiddenIdsRef.current.has(node.id)) continue;
          const arr = agg.get(node.clusterId) ?? [];
          arr.push(node);
          agg.set(node.clusterId, arr);
        }
        for (const [cid, members] of agg) {
          if (members.length < 2) continue;
          let cx = 0, cy = 0;
          for (const m of members) { cx += m.x!; cy += m.y!; }
          cx /= members.length; cy /= members.length;
          let maxR = 0;
          for (const m of members) maxR = Math.max(maxR, Math.hypot(m.x! - cx, m.y! - cy) + m.radius);
          const col = CLUSTER_COLORS[cid % CLUSTER_COLORS.length];
          ctx.beginPath();
          ctx.arc(cx, cy, maxR + 20, 0, Math.PI * 2);
          ctx.fillStyle = hexA(col, 0.11);
          ctx.fill();
          ctx.strokeStyle = hexA(col, 0.33);
          ctx.lineWidth = 1.4;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Pre-compute hover connectivity for highlighting
      const connectedNodes = new Set<string>();
      const connectedEdges = new Set<string>();
      if (hovered) {
        for (const link of linksRef.current) {
          const src = link.source as BubbleNode;
          const tgt = link.target as BubbleNode;
          if (src.id === hovered.id || tgt.id === hovered.id) {
            connectedNodes.add(src.id);
            connectedNodes.add(tgt.id);
            connectedEdges.add(linkKey(link));
          }
        }
      }

      // Stats-filter matching: dim everything that doesn't match
      const activeFilter = filterRef.current;
      const matchesFilter = (n: BubbleNode): boolean => {
        if (!activeFilter) return true;
        const t = n.originalNode.type;
        const meta = n.originalNode.metadata;
        if (activeFilter === 'cabal') return t === 'cabal-funder';
        if (activeFilter === 'snipers') return Boolean(meta?.isSniper);
        if (activeFilter === 'bundles') return n.clusterId >= 0;
        if (activeFilter === 'behavioral') return Boolean(meta?.behavioralCluster);
        return true;
      };

      // ── Beams (curved animated links with arrowhead + traveling comet) ──
      let li = -1;
      for (const link of linksRef.current) {
        li++;
        const src = link.source as BubbleNode;
        const tgt = link.target as BubbleNode;
        if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;
        if (!Number.isFinite(src.x) || !Number.isFinite(src.y) || !Number.isFinite(tgt.x) || !Number.isFinite(tgt.y)) continue;
        if (hiddenIdsRef.current.has(src.id) || hiddenIdsRef.current.has(tgt.id)) continue;
        const sx: number = src.x, sy: number = src.y, tx: number = tgt.x, ty: number = tgt.y;

        const key = linkKey(link);
        const isConnected = connectedEdges.has(key);
        const touched = !!hovered && isConnected;
        // Token spokes (funder→token) stay hidden unless hovered or in cluster mode.
        const isTokenSpoke = src.type === 'token' || tgt.type === 'token';
        if (isTokenSpoke && !touched && !isCluster) continue;

        const filterDim = activeFilter && !(matchesFilter(src) && matchesFilter(tgt));
        const dimmed = (hovered && !isConnected) || filterDim;

        // Base + pulse colors per mode/state.
        let baseStyle: string, beamRGB: string, lw: number;
        const crewColor = isCluster
          ? CLUSTER_COLORS[(src.clusterId >= 0 ? src.clusterId : 0) % CLUSTER_COLORS.length]
          : src.clusterId >= 0 ? CLUSTER_COLORS[src.clusterId % CLUSTER_COLORS.length] : null;
        if (touched) {
          baseStyle = 'rgba(0,255,65,0.5)'; beamRGB = '0,255,65'; lw = 1.9;
        } else if (crewColor) {
          baseStyle = hexA(crewColor, dimmed ? 0.12 : 0.32); beamRGB = rgbStr(crewColor); lw = 1.4;
        } else {
          baseStyle = `rgba(125,170,235,${dimmed ? 0.1 : 0.34})`; beamRGB = '155,200,255'; lw = 1.3;
        }

        // Terminate rim-to-rim: pull the endpoints in by each node's radius (+ a
        // small gap) along the straight line so the beam starts and the arrowhead
        // lands exactly on the bubble edges, not their centers.
        const ddx = tx - sx, ddy = ty - sy;
        const dist = Math.hypot(ddx, ddy) || 1;
        const ux = ddx / dist, uy = ddy / dist;
        const ax = sx + ux * (src.radius + 1.5);
        const ay = sy + uy * (src.radius + 1.5);
        const bx = tx - ux * (tgt.radius + 2.5);
        const by = ty - uy * (tgt.radius + 2.5);
        const span = Math.hypot(bx - ax, by - ay) || 1;

        // Bow: fixed pixel sag (scaled down for short ties), NOT a fraction of length,
        // so a long beam points straight at the node instead of arcing into space.
        const BOW_PX = 14;
        const bow = Math.min(BOW_PX, span * 0.28) * (li % 2 ? 1 : -1);
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const cpx = mx + (-(by - ay) / span) * bow;
        const cpy = my + ((bx - ax) / span) * bow;

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo(cpx, cpy, bx, by);
        ctx.strokeStyle = baseStyle;
        ctx.lineWidth = lw;
        ctx.stroke();

        const animate = !dimmed || touched;

        // Arrowhead at the rim (curve end), pointing into the target node.
        if (animate) {
          const ah = qpt(ax, ay, cpx, cpy, bx, by, 0.86);
          const ang = Math.atan2(by - ah.y, bx - ah.x), s = 4.6;
          ctx.fillStyle = `rgba(${beamRGB},0.9)`;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - Math.cos(ang - 0.5) * s, by - Math.sin(ang - 0.5) * s);
          ctx.lineTo(bx - Math.cos(ang + 0.5) * s, by - Math.sin(ang + 0.5) * s);
          ctx.closePath();
          ctx.fill();
        }

        // Traveling comet: ~9 fading segments looping every 2.6s + glowing head dot.
        if (animate) {
          const period = 2600 / (touched ? 1.6 : 1);
          const phase = (li * 0.137) % 1;
          const tt = ((timestamp / period) + phase) % 1;
          const steps = 9, tail = 0.26;
          ctx.lineCap = 'round';
          for (let i = 0; i < steps; i++) {
            const ta = tt - (tail * i / steps), tb = tt - (tail * (i + 1) / steps);
            if (tb < 0 || ta > 1) continue;
            const p1 = qpt(ax, ay, cpx, cpy, bx, by, Math.max(0, Math.min(1, ta)));
            const p2 = qpt(ax, ay, cpx, cpy, bx, by, Math.max(0, Math.min(1, tb)));
            ctx.strokeStyle = `rgba(${beamRGB},${((1 - i / steps) * 0.9).toFixed(2)})`;
            ctx.lineWidth = lw + 0.7;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
          if (tt >= 0 && tt <= 1) {
            const hp = qpt(ax, ay, cpx, cpy, bx, by, tt);
            ctx.beginPath();
            ctx.arc(hp.x, hp.y, 1.9, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${beamRGB},0.95)`;
            ctx.shadowColor = `rgba(${beamRGB},0.9)`;
            ctx.shadowBlur = 7;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
          ctx.lineCap = 'butt';
        }
      }

      // ── Go-Live pulse rings: expanding green rings on holders ──
      pulsesRef.current = pulsesRef.current.filter(p => { p.life -= 0.018; return p.life > 0; });
      for (const p of pulsesRef.current) {
        const node = nodesRef.current.find(n => n.id === p.id);
        if (!node || node.x == null || node.y == null) continue;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + (1 - p.life) * 40, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,255,65,${(p.life * 0.5).toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── Nodes ──
      const bold = isHeatmap || isCluster;
      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue;
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        if (hiddenIdsRef.current.has(node.id)) continue;

        const type = node.originalNode.type;
        const isHovered = hovered?.id === node.id;
        const isNeighbor = connectedNodes.has(node.id);
        const isDimmed = hovered && !isHovered && !isNeighbor;
        const r = node.radius;

        // Color: heatmap (risk) > cluster recolor > semantic/bundle.
        let color: string;
        if (isHeatmap) color = heatColor(node);
        else if (isCluster && type !== 'token' && type !== 'pool')
          color = CLUSTER_COLORS[(node.clusterId >= 0 ? node.clusterId : 0) % CLUSTER_COLORS.length];
        else color = getNodeColor(type, node.clusterId);

        const nodeFilterDim = activeFilter && !matchesFilter(node);
        ctx.save();
        // Un-connected nodes dim to 55% (readability floor); filter dims further.
        if (isDimmed) ctx.globalAlpha = 0.55;
        if (nodeFilterDim) ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.3;

        const isFunder = type === 'funder' || type === 'cabal-funder';
        const isSolid = isFunder || type === 'funded' || type === 'connected';
        let glow = 0;

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        if (type === 'pool') {
          const g = ctx.createRadialGradient(node.x, node.y, 1, node.x, node.y, r);
          g.addColorStop(0, 'rgba(154,163,178,0.30)');
          g.addColorStop(1, 'rgba(154,163,178,0.04)');
          ctx.fillStyle = g;
        } else if (type === 'token') {
          const g = ctx.createRadialGradient(node.x, node.y, 1, node.x, node.y, r);
          g.addColorStop(0, 'rgba(0,255,65,0.55)');
          g.addColorStop(1, 'rgba(0,255,65,0.10)');
          ctx.fillStyle = g;
          glow = 14;
        } else if (isSolid) {
          // Funder / crew hub: sphere gradient, bright center → 0.78 edge.
          const g = ctx.createRadialGradient(node.x - r * 0.35, node.y - r * 0.35, 0.5, node.x, node.y, r);
          g.addColorStop(0, hexA(color, 1));
          g.addColorStop(0.6, hexA(color, 0.95));
          g.addColorStop(1, hexA(color, 0.78));
          ctx.fillStyle = g;
          glow = bold ? 4 : 6;
        } else {
          // Holder / sniper / bundled: translucent fill (bolder in heatmap/cluster).
          ctx.fillStyle = hexA(color, bold ? 0.42 : 0.14);
          if (bold) glow = 8;
        }
        if (isHovered) glow = Math.max(glow, 12);
        if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
        ctx.fill();
        ctx.shadowBlur = 0;

        // Stroke
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(color, isFunder ? 0.9 : 0.62);
        ctx.lineWidth = isHovered ? 2 : 1.3;
        ctx.stroke();

        // Connected-group accent ring (hover).
        if (hovered && (isHovered || isNeighbor)) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 4.5, 0, Math.PI * 2);
          ctx.strokeStyle = isHovered ? 'rgba(0,255,65,0.95)' : 'rgba(0,255,65,0.6)';
          ctx.lineWidth = isHovered ? 2 : 1.4;
          ctx.shadowColor = 'rgba(0,255,65,0.5)';
          ctx.shadowBlur = isHovered ? 10 : 5;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // Pinned indicator: small dashed ring so users know a node is held in place.
        if (node.pinned && type !== 'token') {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 2, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Find-highlight: pulsing ring around the located node for ~2.2s.
        const hl = highlightRef.current;
        if (hl && hl.id === node.id) {
          if (timestamp < hl.until) {
            const pulse = 6 + 4 * Math.sin(timestamp / 150);
            const remaining = (hl.until - timestamp) / 2200;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + pulse, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0,255,65,${0.85 * remaining})`;
            ctx.lineWidth = 2.5 / t.k;
            ctx.stroke();
          } else {
            highlightRef.current = null;
          }
        }

        // Label: token symbol (dark), else white % when the bubble is big enough.
        if (type === 'token' && node.label) {
          ctx.fillStyle = '#03100a';
          ctx.font = `700 ${Math.max(9, Math.min(13, r * 0.42))}px var(--font-jetbrains-mono), monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(node.label.slice(0, 4).toUpperCase(), node.x, node.y);
        } else if (r > 11 && node.supplyPct >= 0.5) {
          ctx.fillStyle = '#f0f0f0';
          ctx.font = `600 ${Math.max(9, Math.min(13, r * 0.42))}px var(--font-jetbrains-mono), monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(node.supplyPct >= 1 ? node.supplyPct.toFixed(1) + '%' : '<1%', node.x, node.y);
        }

        ctx.restore();
      }

      ctx.restore();
      reportZoom();
      animRef.current = requestAnimationFrame(draw);
    }

    // Kick off render loop; rAF passes timestamp automatically
    animRef.current = requestAnimationFrame(draw);

    // Handle resize: recompute homes against the new size and gently re-anchor.
    const resizeObserver = new ResizeObserver(() => {
      resize();
      const newHomes = computeHomes(
        nodesRef.current.map(n => ({ id: n.id, type: n.type, clusterId: n.clusterId })),
        sizeRef.current.width,
        sizeRef.current.height,
      );
      const cw = sizeRef.current.width, chh = sizeRef.current.height;
      for (const n of nodesRef.current) {
        const home = newHomes.get(n.id);
        if (home) { n.homeX = home.hx; n.homeY = home.hy; }
        if (n.type === 'token') { n.fx = cw / 2; n.fy = chh / 2; n.homeX = cw / 2; n.homeY = chh / 2; }
      }
      if (sim.alpha() < 0.05) sim.alpha(0.05).restart();
    });
    resizeObserver.observe(container);

    return () => {
      sim.stop();
      simRef.current = null;
      autoFitRef.current = null;
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]); // Only restart sim on new scan; poll updates handled incrementally

  // ── Keyboard: Esc closes the context menu ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dismiss the context menu on any outside click.
  useEffect(() => {
    if (!contextMenu) return;
    const onDown = () => setContextMenu(null);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [contextMenu]);

  // ── Mouse move: update hover ref + tooltip state ──
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    // CSS pixel position relative to canvas element
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const drag = dragRef.current;

    // Panning
    if (drag.isDragging && drag.isPanning) {
      const dx = sx - drag.startX;
      const dy = sy - drag.startY;
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      drag.startX = sx;
      drag.startY = sy;
      return;
    }

    // Node dragging: only start after actual movement (5px threshold)
    if (drag.isDragging && drag.draggedNode) {
      const dx = sx - drag.startX;
      const dy = sy - drag.startY;
      const hasMoved = (drag as { hasMoved?: boolean }).hasMoved;

      if (!hasMoved && Math.abs(dx) + Math.abs(dy) < 5) return; // Click, not drag

      // Mark as actual drag
      (drag as { hasMoved?: boolean }).hasMoved = true;

      const { x, y } = screenToWorld(sx, sy);
      drag.draggedNode.fx = x;
      drag.draggedNode.fy = y;
      canvas.style.cursor = 'grabbing';

      // Gentle reheat: just enough for the dragged node
      if (simRef.current && simRef.current.alpha() < 0.03) {
        simRef.current.alpha(0.03).restart();
      }
      return;
    }

    // Hover detection
    const { x, y } = screenToWorld(sx, sy);
    const node = findNodeAt(x, y);

    // Only update ref (no re-render) for canvas drawing
    hoveredNodeRef.current = node;

    // Update tooltip React state (drives the DOM overlay)
    if (node) {
      setTooltip({ node, x: sx, y: sy });
      canvas.style.cursor = 'pointer';
    } else {
      setTooltip(null);
      canvas.style.cursor = 'grab';
    }
  }, [screenToWorld, findNodeAt]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const { x, y } = screenToWorld(sx, sy);
    const node = findNodeAt(x, y);

    // Don't pin node immediately; wait until actual drag movement
    dragRef.current = {
      isDragging: true,
      isPanning: !node,
      startX: sx,
      startY: sy,
      draggedNode: node || null,
      hasMoved: false,
    } as typeof dragRef.current;
  }, [screenToWorld, findNodeAt]);

  const handleMouseUp = useCallback(() => {
    const drag = dragRef.current;
    const wasDrag = (drag as { hasMoved?: boolean }).hasMoved;

    // A dragged node stays pinned where it was dropped (fx/fy persist); double-click unpins.
    if (drag.draggedNode && wasDrag) {
      drag.draggedNode.pinned = true;
    }
    dragRef.current = { isDragging: false, isPanning: false, startX: 0, startY: 0, draggedNode: null };
    if (canvasRef.current) {
      canvasRef.current.style.cursor = hoveredNodeRef.current ? 'pointer' : 'grab';
    }

    // If it was a click (no movement), fire the click handler
    if (!wasDrag && drag.draggedNode && onNodeClick) {
      onNodeClick(drag.draggedNode.originalNode);
    }
  }, [onNodeClick]);

  // Double-click a pinned node → release it back into the layout.
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const node = findNodeAt(x, y);
    if (node && node.type !== 'token' && node.pinned) {
      node.fx = null;
      node.fy = null;
      node.pinned = false;
      if (simRef.current) simRef.current.alpha(0.1).restart();
    }
  }, [screenToWorld, findNodeAt]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const t = transformRef.current;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const newK = Math.max(0.25, Math.min(3, t.k * factor));

    // Zoom toward cursor
    t.x = sx - (sx - t.x) * (newK / t.k);
    t.y = sy - (sy - t.y) * (newK / t.k);
    t.k = newK;
    reportZoom();
  }, [reportZoom]);

  // Zoom toward an arbitrary point (used by the dock +/- buttons, aimed at canvas center).
  const zoomToward = useCallback((cx: number, cy: number, factor: number) => {
    const t = transformRef.current;
    const newK = Math.max(0.25, Math.min(3, t.k * factor));
    t.x = cx - (cx - t.x) * (newK / t.k);
    t.y = cy - (cy - t.y) * (newK / t.k);
    t.k = newK;
    reportZoom();
  }, [reportZoom]);

  const handleZoomIn = useCallback(() => {
    const { width, height } = sizeRef.current;
    zoomToward(width / 2, height / 2, 1.18);
  }, [zoomToward]);

  const handleZoomOut = useCallback(() => {
    const { width, height } = sizeRef.current;
    zoomToward(width / 2, height / 2, 0.85);
  }, [zoomToward]);

  const handleResetView = useCallback(() => {
    autoFitRef.current?.();
  }, []);

  // Export handlers are defined below; refs let the imperative handle call the
  // latest versions without depending on declaration order.
  const handleExportPngRef = useRef<() => void>(() => {});
  const handleExportCsvRef = useRef<() => void>(() => {});

  // Spawn a Go-Live pulse ring on a random holder node.
  const pulseRandom = useCallback(() => {
    const holders = nodesRef.current.filter(n => n.type !== 'token' && n.type !== 'pool');
    if (!holders.length) return;
    const n = holders[Math.floor(Math.random() * holders.length)];
    pulsesRef.current.push({ id: n.id, life: 1 });
  }, []);

  // Imperative surface for the external control dock.
  useImperativeHandle(ref, () => ({
    zoomIn: handleZoomIn,
    zoomOut: handleZoomOut,
    fit: handleResetView,
    exportPng: () => handleExportPngRef.current(),
    exportCsv: () => handleExportCsvRef.current(),
    pulseRandom,
  }), [handleZoomIn, handleZoomOut, handleResetView, pulseRandom]);

  // Export the current canvas as a PNG (already DPR-scaled).
  const handleExportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The live canvas is transparent (grid shows through); composite onto the
    // void background so the exported PNG isn't see-through.
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext('2d');
    if (!octx) return;
    octx.fillStyle = '#050508';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `ricomaps-${Date.now()}.png`;
    a.click();
  }, []);

  // Export the graph nodes as CSV (joins prop data with the sim-computed supplyPct/clusterId).
  const handleExportCsv = useCallback(() => {
    const byId = new Map(nodesRef.current.map(n => [n.id, n]));
    const cols = ['id', 'type', 'label', 'supplyPct', 'amount', 'threatScore', 'threatLevel', 'fundedCount', 'isSniper', 'clusterId'];
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = data.nodes.map(n => {
      const b = byId.get(n.id);
      return [
        n.id, n.type, n.identity?.name || n.label,
        b ? b.supplyPct.toFixed(4) : '',
        n.tokenAmount ?? n.solBalance ?? '',
        n.metadata?.threatScore ?? '', n.metadata?.threatLevel ?? '',
        n.metadata?.fundedCount ?? '', n.metadata?.isSniper ? 'true' : '',
        b ? b.clusterId : '',
      ].map(esc).join(',');
    });
    const csv = [cols.join(','), ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ricomaps-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  handleExportPngRef.current = handleExportPng;
  handleExportCsvRef.current = handleExportCsv;

  // Right-click → context menu on the node under the cursor.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const node = findNodeAt(x, y);
    if (!node) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, node });
  }, [screenToWorld, findNodeAt]);

  const handleMouseLeave = useCallback(() => {
    handleMouseUp();
    hoveredNodeRef.current = null;
    setTooltip(null);
  }, [handleMouseUp]);

  // ── Touch events for mobile ──
  const touchRef = useRef<{ lastDist: number; lastCenter: { x: number; y: number } | null }>({ lastDist: 0, lastCenter: null });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const sx = touch.clientX - rect.left;
      const sy = touch.clientY - rect.top;
      const { x, y } = screenToWorld(sx, sy);
      const node = findNodeAt(x, y);

      dragRef.current = {
        isDragging: true,
        isPanning: !node,
        startX: sx,
        startY: sy,
        draggedNode: node || null,
        hasMoved: false,
      } as typeof dragRef.current;
    } else if (e.touches.length === 2) {
      // Pinch zoom start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current.lastDist = Math.sqrt(dx * dx + dy * dy);
      touchRef.current.lastCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
      };
      // Cancel any single-touch drag
      dragRef.current = { isDragging: false, isPanning: false, startX: 0, startY: 0, draggedNode: null };
    }
  }, [screenToWorld, findNodeAt]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    if (e.touches.length === 2) {
      // Pinch zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

      if (touchRef.current.lastDist > 0) {
        const factor = dist / touchRef.current.lastDist;
        const t = transformRef.current;
        const newK = Math.max(0.1, Math.min(5, t.k * factor));
        t.x = cx - (cx - t.x) * (newK / t.k);
        t.y = cy - (cy - t.y) * (newK / t.k);
        t.k = newK;
      }

      // Also handle two-finger pan
      if (touchRef.current.lastCenter) {
        const panDx = cx - touchRef.current.lastCenter.x;
        const panDy = cy - touchRef.current.lastCenter.y;
        transformRef.current.x += panDx;
        transformRef.current.y += panDy;
      }

      touchRef.current.lastDist = dist;
      touchRef.current.lastCenter = { x: cx, y: cy };
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const sx = touch.clientX - rect.left;
      const sy = touch.clientY - rect.top;
      const drag = dragRef.current;

      if (drag.isDragging && drag.isPanning) {
        const ddx = sx - drag.startX;
        const ddy = sy - drag.startY;
        transformRef.current.x += ddx;
        transformRef.current.y += ddy;
        drag.startX = sx;
        drag.startY = sy;
      } else if (drag.isDragging && drag.draggedNode) {
        const ddx = sx - drag.startX;
        const ddy = sy - drag.startY;
        const hasMoved = (drag as { hasMoved?: boolean }).hasMoved;
        if (!hasMoved && Math.abs(ddx) + Math.abs(ddy) < 10) return;
        (drag as { hasMoved?: boolean }).hasMoved = true;
        const { x, y } = screenToWorld(sx, sy);
        drag.draggedNode.fx = x;
        drag.draggedNode.fy = y;
        if (simRef.current && simRef.current.alpha() < 0.03) {
          simRef.current.alpha(0.03).restart();
        }
      }
    }
  }, [screenToWorld]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      const drag = dragRef.current;
      const wasDrag = (drag as { hasMoved?: boolean }).hasMoved;
      if (drag.draggedNode && wasDrag) {
        drag.draggedNode.pinned = true; // touch-drag pins too
      }
      if (!wasDrag && drag.draggedNode && onNodeClick) {
        onNodeClick(drag.draggedNode.originalNode);
      }
      dragRef.current = { isDragging: false, isPanning: false, startX: 0, startY: 0, draggedNode: null };
      touchRef.current = { lastDist: 0, lastCenter: null };
    } else if (e.touches.length === 1) {
      // Went from pinch to single finger; reset to pan
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      dragRef.current = {
        isDragging: true,
        isPanning: true,
        startX: touch.clientX - rect.left,
        startY: touch.clientY - rect.top,
        draggedNode: null,
      };
      touchRef.current = { lastDist: 0, lastCenter: null };
    }
  }, [onNodeClick]);

  if (!data || data.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black">
        <div className="text-sm text-text-tertiary">No data</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        role="img"
        aria-label={ariaSummary}
        tabIndex={0}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: 'grab', touchAction: 'none' }}
      />

      {/* Context menu */}
      {contextMenu && (
        <div
          className="absolute z-30 min-w-[150px] rounded-lg backdrop-blur-md bg-black/90 border border-white/[0.1] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
          style={{ left: Math.min(contextMenu.x, sizeRef.current.width - 160), top: Math.min(contextMenu.y, sizeRef.current.height - 160) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] font-mono text-text-tertiary border-b border-white/[0.06] truncate">
            {truncateAddress(contextMenu.node.id, 6)}
          </div>
          {([
            ['Copy address', () => { navigator.clipboard.writeText(contextMenu.node.id); }],
            ['Open in explorer', () => { window.open(`https://orbmarkets.io/address/${contextMenu.node.id}`, '_blank', 'noopener'); }],
            ...(contextMenu.node.type !== 'token' && onTraceFunders
              ? [['Trace funders', () => { onTraceFunders(contextMenu.node.originalNode); }] as const]
              : []),
            ['Hide node', () => { hiddenIdsRef.current.add(contextMenu.node.id); }],
          ] as const).map(([label, fn]) => (
            <button
              key={label}
              onClick={() => { fn(); setContextMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Screen-reader-only mirror of nodes */}
      <ul className="sr-only" aria-label="Graph nodes">
        {data.nodes.slice(0, 100).map(n => (
          <li key={n.id}>
            {n.type}: {n.identity?.name || n.label || n.id}
          </li>
        ))}
      </ul>

      {/* Tooltip, clamped to viewport edges */}
      {tooltip && (() => {
        const tooltipW = 200;
        const tooltipH = 120;
        const { width: cw, height: ch } = sizeRef.current;
        const margin = 10;
        let tx = tooltip.x + 15;
        let ty = tooltip.y - 10;
        if (tx + tooltipW > cw - margin) tx = tooltip.x - tooltipW - 15;
        if (ty + tooltipH > ch - margin) ty = ch - tooltipH - margin;
        if (tx < margin) tx = margin;
        if (ty < margin) ty = margin;
        return (
        <div
          className="absolute pointer-events-none z-20 transition-[left,top] duration-75 ease-out"
          style={{
            left: tx,
            top: ty,
          }}
        >
          <div className="px-3 py-2.5 min-w-[170px] max-w-[220px] rounded-lg" style={{ background: 'rgba(13,13,13,0.96)', border: '1px solid #1f1f1f', WebkitBackdropFilter: 'blur(12px)', backdropFilter: 'blur(12px)' }}>
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: getNodeColor(tooltip.node.type, tooltip.node.clusterId) }}
              />
              <span className="text-[12px]" style={{ color: '#f0f0f0' }}>
                {tooltip.node.originalNode.identity?.name || tooltip.node.label}
              </span>
            </div>

            <div className="flex gap-4 text-[11px]">
              <div>
                <div style={{ color: '#737373' }}>Supply</div>
                <div className="font-semibold font-mono" style={{ color: '#f0f0f0' }}>{tooltip.node.supplyPct.toFixed(2)}%</div>
              </div>
              <div>
                <div style={{ color: '#737373' }}>Amount</div>
                <div className="font-semibold font-mono" style={{ color: '#f0f0f0' }}>
                  {tooltip.node.originalNode.tokenAmount
                    ? formatCompact(tooltip.node.originalNode.tokenAmount)
                    : formatCompact(tooltip.node.originalNode.solBalance || 0)
                  }
                </div>
              </div>
              {tooltip.node.clusterId >= 0 && (() => {
                const clusterPct = nodesRef.current
                  .filter(n => n.clusterId === tooltip.node.clusterId)
                  .reduce((sum, n) => sum + n.supplyPct, 0);
                const clusterSize = nodesRef.current.filter(n => n.clusterId === tooltip.node.clusterId).length;
                return (
                  <div>
                    <div style={{ color: '#737373' }}>Bundle</div>
                    <div className="font-semibold font-mono" style={{ color: getNodeColor(tooltip.node.type, tooltip.node.clusterId) }}>
                      {clusterPct.toFixed(2)}%
                      <span className="font-normal ml-0.5" style={{ color: '#737373' }}>({clusterSize})</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {tooltip.node.originalNode.fundingSource?.funderName && (
              <div className="mt-1.5 pt-1.5 text-[11px]" style={{ borderTop: '1px solid #1f1f1f' }}>
                <span style={{ color: '#737373' }}>Funded by </span>
                <span style={{ color: '#b8b8b8' }}>{tooltip.node.originalNode.fundingSource.funderName}</span>
              </div>
            )}

            {tooltip.node.originalNode.type === 'cabal-funder' && (
              <div className="mt-1.5 pt-1.5 text-[11px] font-medium" style={{ borderTop: '1px solid #1f1f1f', color: NODE_COLORS['cabal-funder'] }}>
                Cabal: funded {tooltip.node.originalNode.metadata?.fundedCount} holders
              </div>
            )}
            {tooltip.node.originalNode.metadata?.isSniper && (
              <div className="mt-1.5 pt-1.5 text-[11px] font-medium" style={{ borderTop: '1px solid #1f1f1f', color: NODE_COLORS.sniper }}>
                Sniper: {Math.abs(tooltip.node.originalNode.metadata?.blocksAfterLaunch || 0)} blocks after launch
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
});

function formatCompact(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(1);
}

export default BubbleMap;
