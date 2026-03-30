'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, SimulationNodeDatum, SimulationLinkDatum, Simulation } from 'd3-force';
import { GraphData, GraphNode, GraphLink } from '@/lib/types';

interface BubbleMapProps {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
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

const UNLINKED_COLOR = '#333340';
const BG_COLOR = '#000000';

function computeSupplyPct(node: GraphNode, totalSupply: number): number {
  const amount = node.tokenAmount || node.solBalance || node.val || 0;
  if (totalSupply <= 0) return 0;
  return (amount / totalSupply) * 100;
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

export function BubbleMap({ data, onNodeClick }: BubbleMapProps) {
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

  // Tooltip is the only piece of React state — it drives the overlay DOM
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

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

  // Detect full scan vs incremental poll update
  // Only restart simulation on significant changes (>20% node count diff = new scan)
  const nodeCount = data?.nodes.length || 0;
  const prevCount = prevNodeCountRef.current;
  const isNewScan = prevCount === 0 || Math.abs(nodeCount - prevCount) > prevCount * 0.2;
  if (nodeCount > 0) prevNodeCountRef.current = nodeCount;
  if (isNewScan) dataVersionRef.current++;
  const dataVersion = dataVersionRef.current;

  // Incremental update — just update node token amounts in-place (no sim restart)
  useEffect(() => {
    if (!data || isNewScan) return;
    const nodes = nodesRef.current;
    for (const node of nodes) {
      const updated = data.nodes.find(n => n.id === node.id);
      if (updated) {
        node.originalNode = updated;
        // Recalculate radius if token amount changed
        if (updated.tokenAmount !== undefined) {
          const holders = data.nodes.filter(n => n.type !== 'token');
          const maxAmount = Math.max(...holders.map(n => n.tokenAmount || n.solBalance || 0), 1);
          const amount = updated.tokenAmount || 0;
          const ratio = Math.sqrt(amount / maxAmount);
          node.radius = 8 + ratio * (80 - 8);
          node.supplyPct = computeSupplyPct(updated, holders.reduce((sum, n) => sum + (n.tokenAmount || n.solBalance || 0), 0));
        }
      }
    }
    // Remove nodes that are no longer in data
    const dataIds = new Set(data.nodes.map(n => n.id));
    nodesRef.current = nodes.filter(n => dataIds.has(n.id));
    // Gently reheat sim for repositioning
    if (simRef.current && simRef.current.alpha() < 0.05) {
      simRef.current.alpha(0.05).restart();
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

    const minR = 8, maxR = 80;
    const maxAmount = Math.max(...holders.map(n => n.tokenAmount || n.solBalance || 0), 1);

    const bubbleNodes: BubbleNode[] = data.nodes
      .filter(n => n.type !== 'token')
      .map(node => {
        const amount = node.tokenAmount || node.solBalance || 0;
        const ratio = Math.sqrt(amount / maxAmount);
        const radius = minR + ratio * (maxR - minR);
        return {
          id: node.id,
          label: node.label,
          type: node.type,
          radius,
          supplyPct: computeSupplyPct(node, totalSupply),
          clusterId: clusterMap.get(node.id) ?? -1,
          originalNode: node,
          x: width / 2 + (Math.random() - 0.5) * width * 0.5,
          y: height / 2 + (Math.random() - 0.5) * height * 0.5,
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

    // ── Compute cluster centroids for cluster grouping force ──
    const clusterNodes = new Map<number, BubbleNode[]>();
    for (const node of bubbleNodes) {
      if (node.clusterId < 0) continue;
      const arr = clusterNodes.get(node.clusterId) || [];
      arr.push(node);
      clusterNodes.set(node.clusterId, arr);
    }

    // Precompute cluster centroids
    interface ClusterCentroid { cx: number; cy: number; count: number; totalRadius: number; }
    const centroids = new Map<number, ClusterCentroid>();

    function updateCentroids() {
      centroids.clear();
      for (const [cid, members] of clusterNodes) {
        let cx = 0, cy = 0, totalR = 0;
        for (const m of members) { cx += m.x || 0; cy += m.y || 0; totalR += m.radius; }
        cx /= members.length;
        cy /= members.length;
        centroids.set(cid, { cx, cy, count: members.length, totalRadius: totalR });
      }
    }

    // Force 1: Pull same-cluster nodes toward their centroid (tight clusters)
    function clusterAttract(alpha: number) {
      updateCentroids();
      const strength = alpha * 0.6;
      for (const [cid, members] of clusterNodes) {
        if (members.length < 2) continue;
        const c = centroids.get(cid)!;
        for (const m of members) {
          m.vx = (m.vx || 0) + (c.cx - (m.x || 0)) * strength;
          m.vy = (m.vy || 0) + (c.cy - (m.y || 0)) * strength;
        }
      }
    }

    // Force 2: Push different cluster centroids away from each other
    function clusterRepel(alpha: number) {
      const ids = Array.from(centroids.keys());
      const strength = alpha * 200;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = centroids.get(ids[i])!;
          const b = centroids.get(ids[j])!;
          let dx = a.cx - b.cx;
          let dy = a.cy - b.cy;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = a.totalRadius + b.totalRadius + 30;
          if (dist < minDist) {
            // Capped force — prevents clusters from launching off screen
            const rawForce = strength * (minDist - dist) / dist;
            const cappedForce = Math.min(rawForce, 8);
            const nx = dx / dist * cappedForce;
            const ny = dy / dist * cappedForce;
            const membersA = clusterNodes.get(ids[i])!;
            const membersB = clusterNodes.get(ids[j])!;
            for (const m of membersA) { m.vx = (m.vx || 0) + nx / membersA.length; m.vy = (m.vy || 0) + ny / membersA.length; }
            for (const m of membersB) { m.vx = (m.vx || 0) - nx / membersB.length; m.vy = (m.vy || 0) - ny / membersB.length; }
          }
        }
      }
    }

    // Force 3: Hard boundary — push nodes back if they drift too far from center
    function boundaryForce(alpha: number) {
      const padX = width * 0.42;
      const padY = height * 0.42;
      const cx = width / 2, cy = height / 2;
      for (const node of bubbleNodes) {
        const dx = (node.x || 0) - cx;
        const dy = (node.y || 0) - cy;
        if (Math.abs(dx) > padX) {
          node.vx = (node.vx || 0) - dx * alpha * 0.5;
        }
        if (Math.abs(dy) > padY) {
          node.vy = (node.vy || 0) - dy * alpha * 0.5;
        }
      }
    }

    // Combined cluster force
    function clusterForce(alpha: number) {
      clusterAttract(alpha);
      clusterRepel(alpha);
      boundaryForce(alpha);
    }

    // ── Force simulation — cluster grouping + separation ──
    const sim = forceSimulation(bubbleNodes)
      .force('link', forceLink<BubbleNode, BubbleLink>(bubbleLinks)
        .id(d => d.id)
        .distance(d => {
          const src = d.source as BubbleNode;
          const tgt = d.target as BubbleNode;
          return src.radius + tgt.radius + 5;
        })
        .strength(0.8)
      )
      .force('charge', forceManyBody()
        .strength(-40)
        .distanceMax(250)
      )
      .force('cluster', clusterForce)
      .force('center', forceCenter(width / 2, height / 2).strength(0.12)) // Strong gravity — nothing escapes viewport
      .force('collide', forceCollide<BubbleNode>().radius(d => d.radius + 3).strength(1).iterations(3))
      .alphaDecay(0.012)   // Slow decay — needs time for cluster separation
      .velocityDecay(0.35);

    simRef.current = sim;

    // Auto-fit: once simulation settles, zoom/pan to fit all nodes in viewport
    let hasFitted = false;
    sim.on('tick', () => {
      if (!hasFitted && sim.alpha() < 0.05) {
        hasFitted = true;
        // Compute bounding box of all nodes
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
          const padding = 40;
          const scaleX = (width - padding * 2) / graphW;
          const scaleY = (height - padding * 2) / graphH;
          const k = Math.min(scaleX, scaleY, 1.5); // Cap zoom at 1.5x
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          transformRef.current = {
            x: width / 2 - cx * k,
            y: height / 2 - cy * k,
            k,
          };
        }
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

      // ── Links ──
      for (const link of linksRef.current) {
        const src = link.source as BubbleNode;
        const tgt = link.target as BubbleNode;
        if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;

        const key = linkKey(link);
        const isConnected = connectedEdges.has(key);
        const isDimmed = hovered && !isConnected;

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

          ctx.save();
          ctx.globalAlpha = isDimmed ? 0.3 : isConnected ? 1 : 0.7;

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
      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue;

        const isHovered = hovered?.id === node.id;
        const isNeighbor = connectedNodes.has(node.id);
        const isDimmed = hovered && !isHovered && !isNeighbor;
        const color = node.clusterId >= 0
          ? CLUSTER_COLORS[node.clusterId % CLUSTER_COLORS.length]
          : UNLINKED_COLOR;

        ctx.save();
        if (isDimmed) ctx.globalAlpha = 0.65;

        // Glow
        if (node.clusterId >= 0) {
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
        ctx.fillStyle = color + (node.clusterId >= 0 ? '30' : '20');
        ctx.fill();

        // Border
        ctx.strokeStyle = isHovered ? '#ffffff' : color + (node.clusterId >= 0 ? 'aa' : '60');
        ctx.lineWidth = isHovered ? 2.5 : 1.5;
        ctx.stroke();

        // Supply % label
        if (node.radius > 20 && node.supplyPct >= 0.1) {
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
      // Re-center after resize
      sim.force('center', forceCenter(sizeRef.current.width / 2, sizeRef.current.height / 2).strength(0.05));
      sim.alpha(0.1).restart();
    });
    resizeObserver.observe(container);

    return () => {
      sim.stop();
      simRef.current = null;
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, [dataVersion]); // Only restart sim on new scan — poll updates handled incrementally

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
      <div className="w-full h-full flex items-center justify-center" style={{ background: BG_COLOR }}>
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No data</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full" style={{ background: BG_COLOR }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: 'grab', touchAction: 'none' }}
      />

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
                style={{ background: tooltip.node.clusterId >= 0 ? CLUSTER_COLORS[tooltip.node.clusterId % CLUSTER_COLORS.length] : UNLINKED_COLOR }}
              />
              <span className="text-[11px]" style={{ color: '#f0f0f0' }}>
                {tooltip.node.originalNode.identity?.name || tooltip.node.label}
              </span>
            </div>

            <div className="flex gap-4 text-[10px]">
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
                    <div className="font-semibold font-mono" style={{ color: CLUSTER_COLORS[tooltip.node.clusterId % CLUSTER_COLORS.length] }}>
                      {clusterPct.toFixed(2)}%
                      <span className="font-normal ml-0.5" style={{ color: '#737373' }}>({clusterSize})</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {tooltip.node.originalNode.fundingSource?.funderName && (
              <div className="mt-1.5 pt-1.5 text-[10px]" style={{ borderTop: '1px solid #1f1f1f' }}>
                <span style={{ color: '#737373' }}>Funded by </span>
                <span style={{ color: '#b8b8b8' }}>{tooltip.node.originalNode.fundingSource.funderName}</span>
              </div>
            )}

            {tooltip.node.originalNode.type === 'cabal-funder' && (
              <div className="mt-1.5 pt-1.5 text-[10px] font-medium" style={{ borderTop: '1px solid #1f1f1f', color: '#ef4444' }}>
                Cabal — funded {tooltip.node.originalNode.metadata?.fundedCount} holders
              </div>
            )}
            {tooltip.node.originalNode.metadata?.isSniper && (
              <div className="mt-1.5 pt-1.5 text-[10px] font-medium" style={{ borderTop: '1px solid #1f1f1f', color: '#22d3ee' }}>
                Sniper — {Math.abs(tooltip.node.originalNode.metadata?.blocksAfterLaunch || 0)} blocks after launch
              </div>
            )}
          </div>
        </div>
        );
      })()}
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
