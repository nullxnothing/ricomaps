'use client';

import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, SimulationNodeDatum, SimulationLinkDatum, Simulation } from 'd3-force';
import { GraphData, GraphNode, GraphLink, NODE_COLORS, NodeType } from '@/lib/types';
import { THREAT_COLORS } from '@/lib/threat-scorer';
import { isValidSolanaAddress, truncateAddress } from '@/lib/address-utils';

export type BubbleMapFilter = 'cabal' | 'snipers' | 'bundles' | null;

interface BubbleMapProps {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  onTraceFunders?: (node: GraphNode) => void;
  filter?: BubbleMapFilter;
}

interface BubbleNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: GraphNode['type'];
  radius: number;
  supplyPct: number;
  clusterId: number;
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

const CLUSTER_COLORS = [
  '#5B7FFF', '#FF5B8E', '#5BFFB0', '#FFB85B', '#B05BFF',
  '#5BE8FF', '#FF5B5B', '#C4FF5B', '#FF5BFF', '#5BFFD4',
];

const UNLINKED_COLOR = '#555566';
const BG_COLOR = '#000000';

// Semantic node color by type — falls back to cluster color for generic types
function getNodeColor(type: NodeType, clusterId: number): string {
  const semantic: string | undefined = NODE_COLORS[type];
  if (semantic && semantic !== (NODE_COLORS.default as string)) return semantic;
  if (clusterId >= 0) return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
  return UNLINKED_COLOR;
}

// Legend entries for node types present in the graph
const LEGEND_ENTRIES: { type: NodeType; label: string }[] = [
  { type: 'target', label: 'Target' },
  { type: 'cabal-funder', label: 'Cabal Funder' },
  { type: 'sniper', label: 'Sniper' },
  { type: 'bundled', label: 'Bundled' },
  { type: 'token', label: 'Token' },
  { type: 'pool', label: 'Liquidity Pool' },
  { type: 'holder', label: 'Holder' },
  { type: 'funder', label: 'Funder' },
  { type: 'funded', label: 'Funded' },
  { type: 'connected', label: 'Connected' },
];

function computeSupplyPct(node: GraphNode, totalSupply: number): number {
  const amount = node.tokenAmount || node.solBalance || node.val || 0;
  if (totalSupply <= 0) return 0;
  return (amount / totalSupply) * 100;
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

export function BubbleMap({ data, onNodeClick, onTraceFunders, filter = null }: BubbleMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
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
  // Node ids hidden via the context menu — skipped in the draw loop.
  const hiddenIdsRef = useRef<Set<string>>(new Set());
  // Radius scale (largest holder amount) fixed at scan time, so live balance updates
  // resize one bubble relative to the original scale instead of rescaling the whole graph.
  const maxAmountRef = useRef(1);

  // Tooltip is the only piece of React state — it drives the overlay DOM
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [heatmapMode, setHeatmapMode] = useState(false);
  const heatmapRef = useRef(false);
  heatmapRef.current = heatmapMode;
  const [hullsMode, setHullsMode] = useState(false);
  const hullsRef = useRef(false);
  hullsRef.current = hullsMode;
  const filterRef = useRef<BubbleMapFilter>(null);
  filterRef.current = filter;

  // Find box + context menu state (rare user-driven events, so plain state is fine).
  const [findValue, setFindValue] = useState('');
  const [findError, setFindError] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: BubbleNode } | null>(null);

  // Summary for screen readers — recomputes only when graph changes
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

  // Legend types derived from data (state-driven so legend renders on initial load)
  const legendTypes = useMemo(() => {
    if (!data) return new Set<string>();
    return new Set(data.nodes.filter(n => n.type !== 'token').map(n => n.type));
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

  // Incremental live update — handles streaming deltas without rebuilding the graph:
  //   • existing node balance changed → update radius + supplyPct
  //   • new buyer in data           → add a bubble node (+ its links), gently reheat
  //   • holder removed (sold to 0)   → drop node, its links, and particles
  // A full rebuild only happens on a new scan (isNewScan, handled by the sim effect).
  useEffect(() => {
    if (!data || isNewScan || nodesRef.current.length === 0) return;
    const sim = simRef.current;

    const dataNodeMap = new Map(data.nodes.map(n => [n.id, n]));
    const holders = data.nodes.filter(n => n.type !== 'token');
    const totalSupply = holders.reduce((sum, n) => sum + (n.tokenAmount || n.solBalance || 0), 0);
    // Reuse the scan-time scale so live updates don't rescale every bubble. Only grow it
    // if a holder genuinely exceeds the current max (never shrink — that's what caused the
    // "all bubbles get smaller" flicker when streaming started).
    const liveMax = Math.max(...holders.map(n => n.tokenAmount || n.solBalance || 0), 1);
    const maxAmount = Math.max(maxAmountRef.current, liveMax);
    maxAmountRef.current = maxAmount;
    const clusterMap = assignClusters(data.nodes, data.links);
    const { width, height } = sizeRef.current;

    // 1. Update existing nodes in place — radius now tracks live balance changes.
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
    let added = 0;
    for (const node of data.nodes) {
      if (node.type === 'token' || existingIds.has(node.id)) continue;
      const amount = node.tokenAmount || node.solBalance || 0;
      nodesRef.current.push({
        id: node.id,
        label: node.label,
        type: node.type,
        radius: computeRadius(amount, maxAmount),
        supplyPct: computeSupplyPct(node, totalSupply),
        clusterId: clusterMap.get(node.id) ?? -1,
        originalNode: node,
        x: (width || 800) / 2 + (Math.random() - 0.5) * 80,
        y: (height || 600) / 2 + (Math.random() - 0.5) * 80,
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
      // Reset transform each resize — ctx.scale compounds otherwise
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    const width = sizeRef.current.width;
    const height = sizeRef.current.height;

    // ── Build node/link data ──
    const holders = data.nodes.filter(n => n.type !== 'token');
    const totalSupply = holders.reduce((sum, n) => sum + (n.tokenAmount || n.solBalance || 0), 0);
    const clusterMap = assignClusters(data.nodes, data.links);

    const maxAmount = Math.max(...holders.map(n => n.tokenAmount || n.solBalance || 0), 1);
    maxAmountRef.current = maxAmount; // fix the radius scale for the duration of this scan

    const bubbleNodes: BubbleNode[] = data.nodes
      .filter(n => n.type !== 'token')
      .map(node => {
        const amount = node.tokenAmount || node.solBalance || 0;
        const radius = computeRadius(amount, maxAmount);
        return {
          id: node.id,
          label: node.label,
          type: node.type,
          radius,
          supplyPct: computeSupplyPct(node, totalSupply),
          clusterId: clusterMap.get(node.id) ?? -1,
          originalNode: node,
          x: width / 2 + (Math.random() - 0.5) * Math.min(width, height) * 0.5,
          y: height / 2 + (Math.random() - 0.5) * Math.min(width, height) * 0.5,
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

    // ── Compute cluster membership for cluster force ──
    const clusterNodes = new Map<number, BubbleNode[]>();
    for (const node of bubbleNodes) {
      if (node.clusterId < 0) continue;
      const arr = clusterNodes.get(node.clusterId) || [];
      arr.push(node);
      clusterNodes.set(node.clusterId, arr);
    }

    // Single combined cluster force: attract members + repel overlapping centroids
    function clusterForce(alpha: number) {
      // 1. Compute centroids
      const centroids = new Map<number, { cx: number; cy: number; count: number; totalRadius: number }>();
      for (const [cid, members] of clusterNodes) {
        let cx = 0, cy = 0, totalR = 0;
        for (const m of members) { cx += m.x || 0; cy += m.y || 0; totalR += m.radius; }
        cx /= members.length;
        cy /= members.length;
        centroids.set(cid, { cx, cy, count: members.length, totalRadius: totalR });
      }

      // 2. Pull members toward their centroid
      const attractStrength = alpha * 0.3;
      for (const [cid, members] of clusterNodes) {
        if (members.length < 2) continue;
        const c = centroids.get(cid)!;
        for (const m of members) {
          m.vx = (m.vx || 0) + (c.cx - (m.x || 0)) * attractStrength;
          m.vy = (m.vy || 0) + (c.cy - (m.y || 0)) * attractStrength;
        }
      }

      // 3. Push centroids apart only when overlapping
      const ids = Array.from(centroids.keys());
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = centroids.get(ids[i])!;
          const b = centroids.get(ids[j])!;
          const dx = a.cx - b.cx;
          const dy = a.cy - b.cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = a.totalRadius + b.totalRadius + 20;
          if (dist < minDist) {
            const force = Math.min(alpha * 0.5 * (minDist - dist) / dist, 3);
            const nx = (dx / dist) * force;
            const ny = (dy / dist) * force;
            const membersA = clusterNodes.get(ids[i])!;
            const membersB = clusterNodes.get(ids[j])!;
            for (const m of membersA) { m.vx = (m.vx || 0) + nx / membersA.length; m.vy = (m.vy || 0) + ny / membersA.length; }
            for (const m of membersB) { m.vx = (m.vx || 0) - nx / membersB.length; m.vy = (m.vy || 0) - ny / membersB.length; }
          }
        }
      }
    }

    // ── Force simulation — adapts to graph density ──
    const nLinks = bubbleLinks.length;
    // Charge scales: sparse graphs get light repulsion, dense get more
    const chargeStr = nLinks > 10 ? -60 : -25;
    // Center gravity: sparse graphs need stronger pull to stay compact
    const centerStr = nLinks > 20 ? 0.05 : 0.12;

    const sim = forceSimulation(bubbleNodes)
      .force('link', forceLink<BubbleNode, BubbleLink>(bubbleLinks)
        .id(d => d.id)
        .distance(d => {
          const src = d.source as BubbleNode;
          const tgt = d.target as BubbleNode;
          return src.radius + tgt.radius + 8;
        })
        .strength(0.8)
      )
      .force('charge', forceManyBody()
        .strength(chargeStr)
        .distanceMax(250)
      )
      .force('cluster', clusterForce)
      .force('center', forceCenter(width / 2, height / 2).strength(centerStr))
      .force('collide', forceCollide<BubbleNode>().radius(d => d.radius + 3).strength(0.8).iterations(1))
      .alphaDecay(0.035)
      .velocityDecay(0.4);

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
      if (graphW > 0 && graphH > 0) {
        const padding = 60;
        const scaleX = (width - padding * 2) / graphW;
        const scaleY = (height - padding * 2) / graphH;
        const targetK = Math.min(scaleX, scaleY, 0.9);
        const graphCx = (minX + maxX) / 2;
        const graphCy = (minY + maxY) / 2;
        transformRef.current = {
          x: width / 2 - graphCx * targetK,
          y: height / 2 - graphCy * targetK,
          k: targetK,
        };
      }
    }

    // Layout was pre-warmed, so fit immediately — the graph shows already-arranged.
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
      const dt = lastFrameTimeRef.current ? (timestamp - lastFrameTimeRef.current) / 1000 : 1 / 60;
      lastFrameTimeRef.current = timestamp;

      const { width: w, height: h } = sizeRef.current;
      const t = transformRef.current;
      const hovered = hoveredNodeRef.current;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // ── Cluster hulls (toggle, default-off) — drawn behind everything ──
      // Cheap O(n) blob: per cluster, a translucent circle at the centroid sized to
      // cover its members. Not a true convex hull (which would be per-frame expensive).
      if (hullsRef.current) {
        const agg = new Map<number, { sx: number; sy: number; n: number }>();
        for (const node of nodesRef.current) {
          if (node.clusterId < 0 || node.x == null || node.y == null) continue;
          if (hiddenIdsRef.current.has(node.id)) continue;
          const a = agg.get(node.clusterId) ?? { sx: 0, sy: 0, n: 0 };
          a.sx += node.x; a.sy += node.y; a.n++;
          agg.set(node.clusterId, a);
        }
        for (const [cid, a] of agg) {
          if (a.n < 2) continue;
          const cx = a.sx / a.n, cy = a.sy / a.n;
          let maxR = 0;
          for (const node of nodesRef.current) {
            if (node.clusterId !== cid || node.x == null || node.y == null) continue;
            if (hiddenIdsRef.current.has(node.id)) continue;
            const dx = node.x - cx, dy = node.y - cy;
            maxR = Math.max(maxR, Math.sqrt(dx * dx + dy * dy) + node.radius);
          }
          ctx.beginPath();
          ctx.arc(cx, cy, maxR + 12, 0, Math.PI * 2);
          ctx.fillStyle = CLUSTER_COLORS[cid % CLUSTER_COLORS.length] + '14';
          ctx.fill();
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
        return true;
      };

      // ── Links ──
      for (const link of linksRef.current) {
        const src = link.source as BubbleNode;
        const tgt = link.target as BubbleNode;
        if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;

        const key = linkKey(link);
        const isConnected = connectedEdges.has(key);
        const isDimmed = hovered && !isConnected;
        const filterDim = activeFilter && !(matchesFilter(src) && matchesFilter(tgt));

        // Determine link style based on hover state
        let alpha: number;
        let lineW: number;
        if (link.suspicious) {
          alpha = isDimmed ? 0.35 : isConnected ? 0.9 : 0.6;
          lineW = isDimmed ? 1.2 : isConnected ? 2.5 : 1.5;
        } else {
          alpha = isDimmed ? 0.1 : isConnected ? 0.5 : 0.15;
          lineW = isDimmed ? 0.7 : isConnected ? 1.8 : 0.8;
        }
        if (filterDim) alpha *= 0.15;

        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = link.suspicious
          ? `rgba(255, 91, 142, ${alpha})`
          : `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = lineW;
        ctx.stroke();
      }

      // ── Animated particles on edges ──
      const particleSpeed = 1 / 3; // full traversal in 3 seconds
      for (const link of linksRef.current) {
        const src = link.source as BubbleNode;
        const tgt = link.target as BubbleNode;
        if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;

        const key = linkKey(link);
        const isConnected = connectedEdges.has(key);
        const isDimmed = hovered && !isConnected;

        const edgeParticles = particlesRef.current.get(key);
        if (!edgeParticles) continue;

        const accentColor = link.suspicious ? '#FF5B8E' : (
          src.clusterId >= 0 ? CLUSTER_COLORS[src.clusterId % CLUSTER_COLORS.length] : '#ffffff'
        );

        for (const p of edgeParticles) {
          // Advance particle position
          p.t = (p.t + dt * particleSpeed) % 1;

          const px = src.x + (tgt.x - src.x) * p.t;
          const py = src.y + (tgt.y - src.y) * p.t;

          // Trail: draw a gradient line from behind to current position
          const trailT = Math.max(0, p.t - 0.08);
          const tx = src.x + (tgt.x - src.x) * trailT;
          const ty = src.y + (tgt.y - src.y) * trailT;

          const particleFilterDim = activeFilter && !(matchesFilter(src) && matchesFilter(tgt));
          ctx.save();
          ctx.globalAlpha = (isDimmed ? 0.3 : isConnected ? 1 : 0.7) * (particleFilterDim ? 0.15 : 1);

          // Gradient trail
          const trailGrad = ctx.createLinearGradient(tx, ty, px, py);
          trailGrad.addColorStop(0, 'transparent');
          trailGrad.addColorStop(1, accentColor);
          ctx.strokeStyle = trailGrad;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(px, py);
          ctx.stroke();

          // Glowing head
          const headGlow = ctx.createRadialGradient(px, py, 0, px, py, 5);
          headGlow.addColorStop(0, accentColor);
          headGlow.addColorStop(1, 'transparent');
          ctx.fillStyle = headGlow;
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();

          // Solid core dot
          ctx.fillStyle = accentColor;
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }
      }

      // ── Nodes ──
      const isHeatmap = heatmapRef.current;

      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue;
        if (hiddenIdsRef.current.has(node.id)) continue;

        const isHovered = hovered?.id === node.id;
        const isNeighbor = connectedNodes.has(node.id);
        const isDimmed = hovered && !isHovered && !isNeighbor;

        // Color priority: heatmap > semantic type (pool/cabal/sniper/bundled/token) >
        // cluster color > unlinked. Semantic types must override the cluster hue so a
        // pool/AMM, cabal funder, sniper, etc. always read distinctly. getNodeColor
        // falls back to the cluster color for generic types (holder/funder/connected).
        const threatLevel = node.originalNode.metadata?.threatLevel;
        const threatScore = node.originalNode.metadata?.threatScore || 0;
        let color: string;
        if (isHeatmap && threatLevel) {
          color = THREAT_COLORS[threatLevel] || UNLINKED_COLOR;
        } else {
          color = getNodeColor(node.originalNode.type, node.clusterId);
        }

        const nodeFilterDim = activeFilter && !matchesFilter(node);
        ctx.save();
        if (isDimmed) ctx.globalAlpha = 0.65;
        if (nodeFilterDim) ctx.globalAlpha = (ctx.globalAlpha || 1) * 0.18;

        // Threat ring — drawn OUTSIDE the node for medium+ threats
        if (!isHeatmap && threatLevel && threatScore >= 30) {
          const threatColor = THREAT_COLORS[threatLevel];
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
          ctx.strokeStyle = threatColor;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }

        // Glow
        if (node.clusterId >= 0 || (isHeatmap && threatLevel)) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(node.x, node.y, node.radius * 0.5, node.x, node.y, node.radius + 8);
          grad.addColorStop(0, color + '40');
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Hover ring
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff55';
          ctx.lineWidth = 6;
          ctx.stroke();
        }

        // Main circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = color + (node.clusterId >= 0 || isHeatmap ? '30' : '20');
        ctx.fill();

        // Border
        ctx.strokeStyle = isHovered ? '#ffffff' : color + (node.clusterId >= 0 || isHeatmap ? 'aa' : '60');
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.stroke();

        // Find-highlight: pulsing ring around the located node for ~2.2s.
        const hl = highlightRef.current;
        if (hl && hl.id === node.id) {
          if (timestamp < hl.until) {
            const pulse = 6 + 4 * Math.sin(timestamp / 150);
            const remaining = (hl.until - timestamp) / 2200;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius + pulse, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,255,255,${0.85 * remaining})`;
            ctx.lineWidth = 2.5 / t.k;
            ctx.stroke();
          } else {
            highlightRef.current = null;
          }
        }

        // Supply % label
        if (node.radius > 14 && node.supplyPct >= 0.5) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = `${Math.max(9, Math.min(14, node.radius * 0.35))}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            node.supplyPct >= 1 ? node.supplyPct.toFixed(1) + '%' : '<1%',
            node.x,
            node.y,
          );
        }

        ctx.restore();
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(draw);
    }

    // Kick off render loop — rAF passes timestamp automatically
    animRef.current = requestAnimationFrame(draw);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      resize();
      // Update center force target but don't reheat — nodes stay in place
      sim.force('center', forceCenter(sizeRef.current.width / 2, sizeRef.current.height / 2).strength(0.03));
    });
    resizeObserver.observe(container);

    return () => {
      sim.stop();
      simRef.current = null;
      autoFitRef.current = null;
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, [dataVersion]); // Only restart sim on new scan — poll updates handled incrementally

  // ── Keyboard: "/" focuses the find box, Esc clears find + closes the context menu ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === '/' && !inField) {
        e.preventDefault();
        findInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setContextMenu(null);
        if (findInputRef.current && document.activeElement === findInputRef.current) {
          findInputRef.current.blur();
          setFindValue('');
          setFindError(false);
        }
      }
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

    // Node dragging — only start after actual movement (5px threshold)
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

      // Gentle reheat — just enough for the dragged node
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

    // Don't pin node immediately — wait until actual drag movement
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

    if (drag.draggedNode) {
      drag.draggedNode.fx = null;
      drag.draggedNode.fy = null;
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const t = transformRef.current;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newK = Math.max(0.1, Math.min(5, t.k * factor));

    // Zoom toward cursor
    t.x = sx - (sx - t.x) * (newK / t.k);
    t.y = sy - (sy - t.y) * (newK / t.k);
    t.k = newK;
  }, []);

  // Zoom toward an arbitrary point (used by the +/- buttons, aimed at canvas center).
  const zoomToward = useCallback((cx: number, cy: number, factor: number) => {
    const t = transformRef.current;
    const newK = Math.max(0.1, Math.min(5, t.k * factor));
    t.x = cx - (cx - t.x) * (newK / t.k);
    t.y = cy - (cy - t.y) * (newK / t.k);
    t.k = newK;
  }, []);

  const handleZoomIn = useCallback(() => {
    const { width, height } = sizeRef.current;
    zoomToward(width / 2, height / 2, 1.2);
  }, [zoomToward]);

  const handleZoomOut = useCallback(() => {
    const { width, height } = sizeRef.current;
    zoomToward(width / 2, height / 2, 1 / 1.2);
  }, [zoomToward]);

  const handleResetView = useCallback(() => {
    autoFitRef.current?.();
  }, []);

  // Find a wallet by id, center the view on it, and flash a highlight ring.
  const handleFind = useCallback((raw: string) => {
    const addr = raw.trim();
    if (!addr) return;
    if (!isValidSolanaAddress(addr)) { setFindError(true); return; }
    const node = nodesRef.current.find(n => n.id === addr);
    if (!node || node.x == null || node.y == null) { setFindError(true); return; }
    setFindError(false);

    const { width, height } = sizeRef.current;
    const k = Math.min(2, Math.max(transformRef.current.k, 1.2));
    transformRef.current = { x: width / 2 - node.x * k, y: height / 2 - node.y * k, k };
    highlightRef.current = { id: addr, until: performance.now() + 2200 };
  }, []);

  // Export the current canvas as a PNG (already DPR-scaled, opaque background).
  const handleExportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
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
      if (drag.draggedNode) {
        drag.draggedNode.fx = null;
        drag.draggedNode.fy = null;
      }
      if (!wasDrag && drag.draggedNode && onNodeClick) {
        onNodeClick(drag.draggedNode.originalNode);
      }
      dragRef.current = { isDragging: false, isPanning: false, startX: 0, startY: 0, draggedNode: null };
      touchRef.current = { lastDist: 0, lastCenter: null };
    } else if (e.touches.length === 1) {
      // Went from pinch to single finger — reset to pan
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
    <div ref={containerRef} className="relative w-full h-full" style={{ background: BG_COLOR }}>
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
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: 'grab', touchAction: 'none' }}
      />

      {/* Find a wallet on the canvas */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
        <form
          onSubmit={(e) => { e.preventDefault(); handleFind(findValue); }}
          className="flex items-center gap-1.5 rounded-lg backdrop-blur-md bg-black/70 border border-white/[0.08] px-2 py-1.5"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" className="flex-shrink-0">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={findInputRef}
            value={findValue}
            onChange={(e) => { setFindValue(e.target.value); setFindError(false); }}
            placeholder="Find wallet…"
            spellCheck={false}
            className="w-32 sm:w-44 bg-transparent text-[11px] font-mono text-text-primary placeholder:text-text-tertiary outline-none"
          />
        </form>
        {findError && (
          <span className="text-[10px] font-mono text-red-primary pl-2">Not in graph</span>
        )}
      </div>

      {/* Zoom + view controls (bottom-right, clears the page Deep Scan button) */}
      <div className="absolute bottom-20 right-4 z-10 flex flex-col gap-1.5">
        {([
          ['+', 'Zoom in', handleZoomIn],
          ['−', 'Zoom out', handleZoomOut],
        ] as const).map(([label, title, fn]) => (
          <button
            key={title}
            onClick={fn}
            title={title}
            aria-label={title}
            className="w-9 h-9 flex items-center justify-center rounded-lg backdrop-blur-md bg-black/70 border border-white/[0.08] text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors text-lg leading-none"
          >
            {label}
          </button>
        ))}
        <button
          onClick={handleResetView}
          title="Fit to screen"
          aria-label="Fit to screen"
          className="w-9 h-9 flex items-center justify-center rounded-lg backdrop-blur-md bg-black/70 border border-white/[0.08] text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
        <button
          onClick={handleExportPng}
          title="Export PNG"
          aria-label="Export PNG"
          className="w-9 h-9 flex items-center justify-center rounded-lg backdrop-blur-md bg-black/70 border border-white/[0.08] text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors text-[9px] font-semibold"
        >
          PNG
        </button>
        <button
          onClick={handleExportCsv}
          title="Export CSV"
          aria-label="Export CSV"
          className="w-9 h-9 flex items-center justify-center rounded-lg backdrop-blur-md bg-black/70 border border-white/[0.08] text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors text-[9px] font-semibold"
        >
          CSV
        </button>
      </div>

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

      {/* Tooltip — clamped to viewport edges */}
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
                Cabal — funded {tooltip.node.originalNode.metadata?.fundedCount} holders
              </div>
            )}
            {tooltip.node.originalNode.metadata?.isSniper && (
              <div className="mt-1.5 pt-1.5 text-[11px] font-medium" style={{ borderTop: '1px solid #1f1f1f', color: NODE_COLORS.sniper }}>
                Sniper — {Math.abs(tooltip.node.originalNode.metadata?.blocksAfterLaunch || 0)} blocks after launch
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Bottom-left controls — legend on top, toggles beneath, single aligned column */}
      <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 items-start">
      <ul
        className="pointer-events-none flex flex-col gap-1 rounded-lg backdrop-blur-md bg-black/70 border border-white/[0.06] px-3 py-2"
        role="list"
        aria-label={heatmapMode ? 'Threat level legend' : 'Node type legend'}
      >
        {heatmapMode ? (
          ([
            ['critical', 'Critical (70-100)'],
            ['high', 'High (50-69)'],
            ['medium', 'Medium (30-49)'],
            ['low', 'Low (15-29)'],
            ['safe', 'Safe (0-14)'],
          ] as const).map(([level, label]) => (
            <li key={level} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: THREAT_COLORS[level] }}
                aria-hidden="true"
              />
              <span className="text-[10px] text-text-tertiary">{label}</span>
            </li>
          ))
        ) : (
          LEGEND_ENTRIES
            .filter(entry => legendTypes.has(entry.type))
            .map(entry => (
              <li key={entry.type} className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: NODE_COLORS[entry.type] }}
                  aria-hidden="true"
                />
                <span className="text-[10px] text-text-tertiary">{entry.label}</span>
              </li>
            ))
        )}
      </ul>

      {/* Toggle row */}
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-150 pointer-events-auto backdrop-blur-md"
          style={{
            background: heatmapMode ? 'rgba(255,136,0,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${heatmapMode ? 'rgba(255,136,0,0.25)' : 'rgba(255,255,255,0.08)'}`,
            color: heatmapMode ? '#ff8800' : '#888',
          }}
          onClick={() => setHeatmapMode(!heatmapMode)}
          aria-label="Toggle risk heatmap"
          aria-pressed={heatmapMode}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          {heatmapMode ? 'Heatmap ON' : 'Heatmap'}
        </button>

        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-150 pointer-events-auto backdrop-blur-md"
          style={{
            background: hullsMode ? 'rgba(91,127,255,0.12)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${hullsMode ? 'rgba(91,127,255,0.25)' : 'rgba(255,255,255,0.08)'}`,
            color: hullsMode ? '#5B7FFF' : '#888',
          }}
          onClick={() => setHullsMode(!hullsMode)}
          aria-label="Toggle cluster hulls"
          aria-pressed={hullsMode}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
          </svg>
          {hullsMode ? 'Clusters ON' : 'Clusters'}
        </button>
      </div>
      </div>
    </div>
  );
}

function formatCompact(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(1);
}

export default BubbleMap;
