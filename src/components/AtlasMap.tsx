'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation,
  type Simulation, type SimulationNodeDatum,
} from 'd3-force';
import type {
  AtlasCabalBuyEvent, AtlasCabalNode, AtlasGraduationEvent, AtlasGraph, AtlasRugEvent, AtlasSpawnEvent, AtlasToken, AtlasTokenStatus,
} from '@/lib/types';
import { formatUsd } from '@/lib/format';

/**
 * The battlefield canvas: cabal cores with their token constellations in the
 * center, a drifting outer ring of fresh launches, and a slow radar sweep.
 * Live events arrive through the imperative handle so SSE frames never trigger
 * React re-renders.
 */

export interface AtlasMapHandle {
  spawn: (e: AtlasSpawnEvent) => void;
  graduate: (e: AtlasGraduationEvent) => void;
  rug: (e: AtlasRugEvent) => void;
  buy: (e: AtlasCabalBuyEvent) => void;
}

interface AtlasMapProps {
  graph: AtlasGraph | null;
  selectedCabalId: string | null;
  onSelectCabal: (cabal: AtlasCabalNode | null) => void;
  onSelectToken: (token: AtlasToken | null) => void;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  kind: 'cabal' | 'token' | 'spawn';
  r: number;
  cabal?: AtlasCabalNode;
  token?: AtlasToken;
  symbol?: string;
  linked?: boolean;
  bornAt?: number; // ms; spawn fade-in / expiry
}

interface Effect {
  x: number; y: number;
  color: string;
  start: number;
  duration: number;
  maxR: number;
}

// A "crew feeding a token" stream: flowing bubbles along a cabal→token arc.
interface Beam {
  cabalId: string;
  mint: string;
  start: number;       // performance.now()
  duration: number;
  seed: number;        // per-beam arc-bow + phase offset so stacked beams don't overlap
  isPurple: boolean;   // laundered/mixer crews beam purple, not red
}

const STATUS_COLORS: Record<AtlasTokenStatus, string> = {
  watching: '#8a8a96',
  scanned: '#b8b8c2',
  alive: '#00d938',
  rugged: '#ef4444',
  dead: '#3a3a46',
};
const SPAWN_COLOR = '#6b6b78';
const CABAL_RED = '#ef4444';
const CABAL_PURPLE = '#a78bfa';
const SWEEP_RGB = '0, 255, 65';

const SPAWN_TTL_MS = 90_000;
const SPAWN_RING_RADIUS = 330;     // live spawns + unaffiliated trending tokens (ambient outer ring)
const MAX_SPAWN_NODES = 90;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3.5;

// An unlinked token (trending, no tracked cabal) belongs to the dim outer ring,
// not the bright cabal systems in the center.
function isOuterRing(n: SimNode): boolean {
  return n.kind === 'spawn' || (n.kind === 'token' && !n.linked);
}

const BEAM_DURATION_MS = 2600;
const BEAM_PARTICLES = 6;
const MAX_BEAMS = 48;
const TOKEN_HOT_MS = 2600;  // how long a freshly-bought token keeps its feeding halo

function cabalColor(c: AtlasCabalNode): string {
  return c.funderCategory === 'laundered' || c.funderCategory === 'mixer' ? CABAL_PURPLE : CABAL_RED;
}

/**
 * Custom d3 force: nudge each linked token toward its cabal's current position
 * every tick, so a crew + its tokens settle as one tight cluster. `cabalOf` maps
 * token-id → cabal SimNode; strength is the per-tick lerp fraction.
 */
function clusterForce(cabalOf: Map<string, SimNode>, strength: number) {
  let nodes: SimNode[] = [];
  function force(alpha: number) {
    const k = strength * alpha;
    for (const n of nodes) {
      const c = cabalOf.get(n.id);
      if (!c) continue;
      n.vx = (n.vx ?? 0) + ((c.x ?? 0) - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + ((c.y ?? 0) - (n.y ?? 0)) * k;
    }
  }
  force.initialize = (n: SimNode[]) => { nodes = n; };
  return force;
}

function cabalRadius(c: AtlasCabalNode): number {
  // Cabals are the suns, sized by reach (tokens controlled) + money extracted.
  const extractedBoost = Math.min(10, Math.sqrt(c.estExtractedUsd / 6_000));
  return Math.min(28, 10 + 2.6 * Math.sqrt(c.tokenCount) + extractedBoost);
}

function tokenRadius(t: AtlasToken): number {
  // Tokens with a logo get a slightly larger floor so the image stays legible.
  const base = t.image ? 5 : 3.5;
  return base + Math.min(5, Math.log10(1 + (t.liquidityUsd ?? 0)));
}

export const AtlasMap = forwardRef<AtlasMapHandle, AtlasMapProps>(function AtlasMap(
  { graph, selectedCabalId, onSelectCabal, onSelectToken },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<{ source: SimNode; target: SimNode }[]>([]);
  const effectsRef = useRef<Effect[]>([]);
  const beamsRef = useRef<Beam[]>([]);
  const hotTokensRef = useRef<Map<string, number>>(new Map()); // mint -> last-buy ms (feeding halo)
  const hoverRef = useRef<SimNode | null>(null);
  const viewRef = useRef({ k: 0.62, tx: 0, ty: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  // Focus mode: ids of the selected cabal + its tokens. Empty = no focus (all bright).
  const focusRef = useRef<Set<string>>(new Set());
  const fittedRef = useRef(false); // first fit done, afterward we ease toward the target
  const userMovedRef = useRef(false); // once the user pans/zooms, stop auto-framing
  const hadNodesRef = useRef(false); // distinguishes the first populated graph from polls
  const monoRef = useRef('monospace');
  // Token logo cache: mint -> HTMLImageElement once loaded, or null while failed/pending.
  const imgCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const callbacksRef = useRef({ onSelectCabal, onSelectToken });
  useEffect(() => {
    callbacksRef.current = { onSelectCabal, onSelectToken };
  }, [onSelectCabal, onSelectToken]);

  const upsertEventNode = (mint: string, symbol?: string): SimNode => {
    const angle = Math.random() * Math.PI * 2;
    const node: SimNode = {
      id: mint, kind: 'token', r: 4.5, symbol,
      x: Math.cos(angle) * SPAWN_RING_RADIUS * 0.8, y: Math.sin(angle) * SPAWN_RING_RADIUS * 0.8,
    };
    nodesRef.current.push(node);
    return node;
  };

  const restartSim = (): void => {
    simRef.current?.nodes(nodesRef.current);
    simRef.current?.alpha(0.25).restart();
  };

  // Lazily load a token logo into the cache, routed through our same-origin proxy
  // (/api/img) so CORS-less CDNs (dexscreener/gecko/IPFS) still draw. Failures
  // cache null so we don't retry every frame.
  const ensureImage = (mint: string, url?: string): void => {
    if (!url) return;
    const cache = imgCacheRef.current;
    if (cache.has(mint)) return;
    cache.set(mint, null);
    const img = new Image();
    img.onload = () => cache.set(mint, img);
    img.onerror = () => cache.set(mint, null);
    img.src = `/api/img?u=${encodeURIComponent(url)}`;
  };

  // ── Live event handle ──────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    spawn(e) {
      const nodes = nodesRef.current;
      if (nodes.some((n) => n.id === e.mint)) return;
      const spawns = nodes.filter((n) => n.kind === 'spawn');
      if (spawns.length >= MAX_SPAWN_NODES) {
        const oldest = spawns.reduce((a, b) => ((a.bornAt ?? 0) < (b.bornAt ?? 0) ? a : b));
        nodes.splice(nodes.indexOf(oldest), 1);
      }
      const angle = Math.random() * Math.PI * 2;
      const node: SimNode = {
        id: e.mint, kind: 'spawn', r: 2.5, symbol: e.symbol, bornAt: Date.now(),
        x: Math.cos(angle) * SPAWN_RING_RADIUS, y: Math.sin(angle) * SPAWN_RING_RADIUS,
      };
      nodes.push(node);
      effectsRef.current.push({ x: node.x!, y: node.y!, color: `rgba(${SWEEP_RGB},0.5)`, start: performance.now(), duration: 900, maxR: 16 });
      restartSim();
    },
    graduate(e) {
      const node = nodesRef.current.find((n) => n.id === e.mint);
      const target = node ?? upsertEventNode(e.mint, e.symbol);
      target.kind = 'token';
      target.r = 4.5;
      target.bornAt = undefined;
      target.token = target.token ?? {
        mint: e.mint, symbol: e.symbol, name: e.name, status: 'watching', createdAt: e.ts, graduatedAt: e.ts,
      };
      effectsRef.current.push({ x: target.x ?? 0, y: target.y ?? 0, color: `rgba(${SWEEP_RGB},0.85)`, start: performance.now(), duration: 1400, maxR: 34 });
      restartSim();
    },
    rug(e) {
      const node = nodesRef.current.find((n) => n.id === e.mint);
      if (node?.token) node.token = { ...node.token, status: 'rugged', estExtractedUsd: e.estExtractedUsd };
      const x = node?.x ?? 0;
      const y = node?.y ?? 0;
      effectsRef.current.push(
        { x, y, color: 'rgba(239,68,68,0.9)', start: performance.now(), duration: 1100, maxR: 44 },
        { x, y, color: 'rgba(239,68,68,0.5)', start: performance.now() + 180, duration: 1100, maxR: 64 },
      );
    },
    buy(e) {
      const cabal = nodesRef.current.find((n) => n.id === e.cabalId && n.kind === 'cabal');
      if (!cabal) return; // crew not on the current board, nothing to beam from

      // Token may not be a node yet (first buy of a fresh token): spawn + link it
      // so the constellation grows live as the crew piles in.
      let token = nodesRef.current.find((n) => n.id === e.mint);
      if (!token) {
        token = upsertEventNode(e.mint, e.symbol);
        token.linked = true;
        linksRef.current.push({ source: cabal, target: token });
        restartSim();
      } else if (!linksRef.current.some((l) => l.source.id === e.cabalId && l.target.id === e.mint)) {
        token.linked = true;
        linksRef.current.push({ source: cabal, target: token });
      }

      const beams = beamsRef.current;
      if (beams.length >= MAX_BEAMS) beams.shift();
      beams.push({
        cabalId: e.cabalId, mint: e.mint, start: performance.now(),
        duration: BEAM_DURATION_MS, seed: Math.random(),
        isPurple: cabal.cabal ? cabalColor(cabal.cabal) === CABAL_PURPLE : false,
      });
      hotTokensRef.current.set(e.mint, Date.now());
    },
  }), []);

  // ── Build / rebuild simulation when the graph snapshot changes ─────────
  useEffect(() => {
    if (!graph) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));

    // Pre-seed positions so the FIRST frame already looks like a settled map
    // (no fly-in from origin): cabals evenly around a mid ring, their tokens
    // clustered next to their core, unaffiliated tokens on the outer ring.
    const cabalCount = Math.max(1, graph.cabals.length);
    const CABAL_RING = 200;
    const cabalSeed = new Map<string, { x: number; y: number }>();
    const cabalNodes: SimNode[] = graph.cabals.map((c, i) => {
      const a = (i / cabalCount) * Math.PI * 2;
      const seed = { x: Math.cos(a) * CABAL_RING, y: Math.sin(a) * CABAL_RING };
      cabalSeed.set(c.id, seed);
      const p = prev.get(c.id);
      return { id: c.id, kind: 'cabal', r: cabalRadius(c), cabal: c, x: p?.x ?? seed.x, y: p?.y ?? seed.y };
    });
    const linkedMints = new Set(graph.edges.map((e) => e.mint));
    const tokenCabal = new Map<string, string>();
    for (const e of graph.edges) if (!tokenCabal.has(e.mint)) tokenCabal.set(e.mint, e.cabalId);
    const tokenNodes: SimNode[] = graph.tokens.map((t, i) => {
      ensureImage(t.mint, t.image);
      const p = prev.get(t.mint);
      let sx: number, sy: number;
      const ownerSeed = cabalSeed.get(tokenCabal.get(t.mint) ?? '');
      if (ownerSeed) {
        // Linked token: spawn just off its cabal core.
        const a = Math.random() * Math.PI * 2;
        sx = ownerSeed.x + Math.cos(a) * 34;
        sy = ownerSeed.y + Math.sin(a) * 34;
      } else {
        // Unaffiliated: out on the ambient ring.
        const a = (i / Math.max(1, graph.tokens.length)) * Math.PI * 2;
        sx = Math.cos(a) * SPAWN_RING_RADIUS;
        sy = Math.sin(a) * SPAWN_RING_RADIUS;
      }
      return {
        id: t.mint, kind: 'token', r: tokenRadius(t), token: t, symbol: t.symbol,
        linked: linkedMints.has(t.mint),
        x: p?.x ?? sx, y: p?.y ?? sy,
      };
    });
    // Keep live spawn nodes that the snapshot doesn't know about yet.
    const known = new Set([...cabalNodes, ...tokenNodes].map((n) => n.id));
    const spawnNodes = nodesRef.current.filter((n) => n.kind === 'spawn' && !known.has(n.id));

    const nodes = [...cabalNodes, ...tokenNodes, ...spawnNodes];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = graph.edges
      .filter((e) => byId.has(e.cabalId) && byId.has(e.mint))
      .map((e) => ({ source: byId.get(e.cabalId)!, target: byId.get(e.mint)! }));

    const isFirstPopulation = nodesRef.current.length === 0 || !hadNodesRef.current;
    nodesRef.current = nodes;
    linksRef.current = links;
    if (nodes.length > 0) hadNodesRef.current = true;
    // Only (re)frame on the very first populated graph. Later 60s polls must NOT
    // snap the camera; that was the jarring re-zoom mid-session.
    if (isFirstPopulation && nodes.length > 0) {
      fittedRef.current = false;
      userMovedRef.current = false;
    }

    // Map each linked token to its cabal node so tokens cluster tightly around
    // their crew; this is what turns confetti into legible "systems".
    const cabalOf = new Map<string, SimNode>();
    for (const e of graph.edges) {
      const c = byId.get(e.cabalId);
      const t = byId.get(e.mint);
      if (c && t && !cabalOf.has(t.id)) cabalOf.set(t.id, c);
    }

    simRef.current?.stop();
    simRef.current = forceSimulation<SimNode>(nodes)
      // Moderate cabal repulsion: enough to avoid overlap, not so much that the
      // field blows apart and forces the camera to zoom way out. Tokens barely repel.
      .force('charge', forceManyBody<SimNode>().strength((n) => (n.kind === 'cabal' ? -240 : -8)).distanceMax(360))
      // Short, firm links pull a crew's tokens into a tight orbit around it.
      .force('link', forceLink<SimNode, { source: SimNode; target: SimNode }>(links).distance(30).strength(0.9))
      .force('collide', forceCollide<SimNode>().radius((n) => n.r + 4))
      // Firm centering keeps the whole battlefield compact and on-screen.
      .force('center', forceCenter(0, 0).strength(0.06))
      // Outer ring: unaffiliated tokens + live spawns sit far out, behind the systems.
      .force('ring', forceRadial<SimNode>(
        (n) => (isOuterRing(n) ? SPAWN_RING_RADIUS : 0), 0, 0,
      ).strength((n) => (isOuterRing(n) ? 0.18 : 0)))
      // Extra pull of each linked token toward its own cabal's live position.
      .force('cluster', clusterForce(cabalOf, 0.4))
      .velocityDecay(0.45)
      // Pre-seeded layout is already close to final, so start gentle: less churn,
      // faster settle, no wild fly-out. Re-runs (polls) start gentler still.
      .alpha(isFirstPopulation ? 0.4 : 0.1)
      .alphaDecay(0.035);

    return () => { simRef.current?.stop(); };
  }, [graph]);

  // Recompute the focus set whenever selection (or the edge set) changes.
  useEffect(() => {
    if (!selectedCabalId || !graph) {
      focusRef.current = new Set();
      return;
    }
    const set = new Set<string>([selectedCabalId]);
    for (const e of graph.edges) if (e.cabalId === selectedCabalId) set.add(e.mint);
    focusRef.current = set;
  }, [selectedCabalId, graph]);

  // ── Canvas lifecycle: resize, render loop, interaction ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ctx.font can't resolve CSS vars; read the loaded mono family once.
    const monoVar = getComputedStyle(document.documentElement).getPropertyValue('--font-jetbrains-mono').trim();
    monoRef.current = monoVar || "'JetBrains Mono', monospace";

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      sizeRef.current = { w, h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const toWorld = (sx: number, sy: number) => {
      const { k, tx, ty } = viewRef.current;
      const { w, h } = sizeRef.current;
      return { x: (sx - w / 2 - tx) / k, y: (sy - h / 2 - ty) / k };
    };

    const hitTest = (sx: number, sy: number): SimNode | null => {
      const { x, y } = toWorld(sx, sy);
      let best: SimNode | null = null;
      let bestDist = Infinity;
      for (const n of nodesRef.current) {
        const dx = (n.x ?? 0) - x;
        const dy = (n.y ?? 0) - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < n.r + 4 && d < bestDist) { best = n; bestDist = d; }
      }
      return best;
    };

    // Pan / zoom / click
    let dragging = false;
    let moved = 0;
    let last = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      last = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (dragging) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 5) userMovedRef.current = true; // hand control to the user
        viewRef.current.tx += dx;
        viewRef.current.ty += dy;
        last = { x: e.clientX, y: e.clientY };
      } else {
        hoverRef.current = hitTest(e.clientX - rect.left, e.clientY - rect.top);
        canvas.style.cursor = hoverRef.current ? 'pointer' : 'crosshair';
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      if (moved < 5) {
        const rect = canvas.getBoundingClientRect();
        const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hit?.kind === 'cabal' && hit.cabal) {
          callbacksRef.current.onSelectCabal(hit.cabal);
          callbacksRef.current.onSelectToken(null);
        } else if (hit?.token) {
          callbacksRef.current.onSelectToken(hit.token);
          callbacksRef.current.onSelectCabal(null);
        } else {
          callbacksRef.current.onSelectCabal(null);
          callbacksRef.current.onSelectToken(null);
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMovedRef.current = true; // user is driving the camera now
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const view = viewRef.current;
      const { w, h } = sizeRef.current;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const k2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * factor));
      // Zoom around the cursor: keep the world point under it fixed.
      const wx = (sx - w / 2 - view.tx) / view.k;
      const wy = (sy - h / 2 - view.ty) / view.k;
      view.tx = sx - w / 2 - wx * k2;
      view.ty = sy - h / 2 - wy * k2;
      view.k = k2;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { w, h } = sizeRef.current;
      const { k, tx, ty } = viewRef.current;
      const now = performance.now();

      // Keep a target zoom that frames the whole field; ease the view toward it
      // each frame instead of snapping. Because nodes are pre-seeded near their
      // final spots, the very first frame is already roughly fitted: no empty
      // canvas, no jarring re-zoom. The user's manual pan/zoom cancels the easing.
      if (!userMovedRef.current && nodesRef.current.length > 1 && w > 0) {
        // Frame to the CABAL SYSTEMS (the subject), not the sparse outer ring;
        // otherwise a few far-flung trending tokens force the zoom way out and
        // leave the center tiny. Fall back to all nodes if no cabals yet.
        let maxR = 0;
        let sawCabalSystem = false;
        for (const n of nodesRef.current) {
          if (n.kind === 'cabal' || (n.kind === 'token' && n.linked)) {
            sawCabalSystem = true;
            const d = Math.hypot(n.x ?? 0, n.y ?? 0) + n.r;
            if (d > maxR) maxR = d;
          }
        }
        if (!sawCabalSystem) {
          for (const n of nodesRef.current) {
            const d = Math.hypot(n.x ?? 0, n.y ?? 0) + n.r;
            if (d > maxR) maxR = d;
          }
        }
        if (maxR > 0) {
          // k so the field radius fills ~72% of the smaller half-dimension: the
          // systems fill most of the viewport with margin for edge cores + labels.
          const target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (Math.min(w, h) * 0.72) / maxR));
          const v = viewRef.current;
          if (!fittedRef.current) {
            // First fit: snap straight to target (pre-seeded nodes are already framed).
            v.k = target; v.tx = 0; v.ty = 0;
            fittedRef.current = true;
          } else if ((simRef.current?.alpha() ?? 0) > 0.05) {
            // While the sim is still settling, gently track the growing field so it
            // never spills off-screen, then STOP (below alpha 0.05) and hand the
            // camera to the user. No perpetual zoom-drift.
            v.k += (target - v.k) * 0.05;
            v.tx += (0 - v.tx) * 0.05;
            v.ty += (0 - v.ty) * 0.05;
          }
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Void vignette
      const vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
      vignette.addColorStop(0, '#0a0a10');
      vignette.addColorStop(1, '#050508');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);

      ctx.translate(w / 2 + tx, h / 2 + ty);
      ctx.scale(k, k);

      const focus = focusRef.current;
      drawGraticule(ctx, now);
      drawLinks(ctx, linksRef.current, focus);
      drawBeams(ctx, beamsRef.current, nodesRef.current, now, focus);
      drawEffects(ctx, effectsRef.current, now);
      drawNodes(ctx, nodesRef.current, hoverRef.current, k, now, monoRef.current, focus, hotTokensRef.current, imgCacheRef.current);
      drawHoverChip(ctx, hoverRef.current, k, monoRef.current);

      // Expire spawn nodes (fade handled in drawNodes)
      const cutoff = Date.now() - SPAWN_TTL_MS;
      const before = nodesRef.current.length;
      nodesRef.current = nodesRef.current.filter((n) => n.kind !== 'spawn' || (n.bornAt ?? 0) > cutoff);
      if (nodesRef.current.length !== before) simRef.current?.nodes(nodesRef.current);
      effectsRef.current = effectsRef.current.filter((e) => now - e.start < e.duration);
      beamsRef.current = beamsRef.current.filter((b) => now - b.start < b.duration);
      const hotCutoff = Date.now() - TOKEN_HOT_MS;
      for (const [mint, t] of hotTokensRef.current) if (t < hotCutoff) hotTokensRef.current.delete(mint);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} />
      {!graph && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            <span className="w-1.5 h-1.5 rounded-full bg-green-primary" style={{ animation: 'tx-pulse 1.2s ease-in-out infinite' }} />
            Scanning the ecosystem…
          </div>
        </div>
      )}
    </div>
  );
});

// ── Pure draw helpers (world space unless noted) ──────────────────────────

function drawGraticule(ctx: CanvasRenderingContext2D, now: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (const r of [140, 280, 420]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-460, 0); ctx.lineTo(460, 0);
  ctx.moveTo(0, -460); ctx.lineTo(0, 460);
  ctx.stroke();

  // The sweep: a thin rotating radar line + faint leading wedge, reads as "live
  // radar," not a graphical artifact. One slow rotation every 18s.
  const angle = ((now / 18_000) % 1) * Math.PI * 2;
  const R = 440;
  const wedge = ctx.createConicGradient(angle, 0, 0);
  wedge.addColorStop(0, `rgba(${SWEEP_RGB}, 0.05)`);
  wedge.addColorStop(0.05, `rgba(${SWEEP_RGB}, 0.012)`);
  wedge.addColorStop(0.1, 'rgba(0,0,0,0)');
  wedge.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wedge;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();
  // The leading line.
  ctx.strokeStyle = `rgba(${SWEEP_RGB}, 0.16)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(angle) * R, Math.sin(angle) * R);
  ctx.stroke();
  ctx.restore();
}

/**
 * Cabal→token "controls" links. Each is a gradient (crew color → faint green
 * token) so the direction of control reads, and opacity is high enough that the
 * crew systems are obviously connected; this is the core comprehension cue.
 */
function drawLinks(ctx: CanvasRenderingContext2D, links: { source: SimNode; target: SimNode }[], focus: Set<string>): void {
  const focusing = focus.size > 0;
  ctx.save();
  ctx.lineWidth = 1.1;
  for (const l of links) {
    const sx = l.source.x ?? 0, sy = l.source.y ?? 0;
    const tx = l.target.x ?? 0, ty = l.target.y ?? 0;
    // Skip links whose endpoints haven't been assigned finite positions yet
    // (a new node added mid-frame seeds NaN until the sim ticks) — a non-finite
    // coordinate makes createLinearGradient throw.
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    const inFocus = !focusing || focus.has(l.source.id) || focus.has(l.target.id);
    const a = inFocus ? 0.42 : 0.04;
    const isPurple = l.source.cabal ? cabalColor(l.source.cabal) === CABAL_PURPLE : false;
    const core = isPurple ? '167,139,250' : '239,68,68';
    const grad = ctx.createLinearGradient(sx, sy, tx, ty);
    grad.addColorStop(0, `rgba(${core},${a})`);
    grad.addColorStop(1, `rgba(0,217,56,${a * 0.55})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = inFocus && focusing ? 1.6 : 1.1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEffects(ctx: CanvasRenderingContext2D, effects: Effect[], now: number): void {
  for (const e of effects) {
    const t = (now - e.start) / e.duration;
    if (t < 0 || t > 1) continue;
    const ease = 1 - Math.pow(1 - t, 2);
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2 + ease * e.maxR, 0, Math.PI * 2);
    ctx.strokeStyle = e.color.replace(/[\d.]+\)$/, `${(1 - t) * 0.9})`);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

/**
 * Crew-buy beams: flowing bubbles streaming along a bowed cabal→token arc. Each
 * beam fades in (first 12%) and out (last 25%); particles ride staggered phases
 * so the stream reads as continuous feeding. Colored cabal-core → token-green.
 */
function drawBeams(ctx: CanvasRenderingContext2D, beams: Beam[], nodes: SimNode[], now: number, focus: Set<string>): void {
  const focusing = focus.size > 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const beam of beams) {
    const cabal = byId.get(beam.cabalId);
    const token = byId.get(beam.mint);
    if (!cabal || !token) continue;

    const t = (now - beam.start) / beam.duration;
    if (t < 0 || t > 1) continue;
    const fade = t < 0.12 ? t / 0.12 : t > 0.75 ? (1 - t) / 0.25 : 1;
    const dim = focusing && !focus.has(beam.cabalId) ? 0.15 : 1;
    const core = beam.isPurple ? '167,139,250' : '239,68,68';

    const ax = cabal.x ?? 0, ay = cabal.y ?? 0;
    const bx = token.x ?? 0, by = token.y ?? 0;
    // Perpendicular control point gives the arc its bow; sign/scale from the seed.
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const bow = (beam.seed - 0.5) * 0.5 * len;
    const cx = mx + (-dy / len) * bow;
    const cy = my + (dx / len) * bow;

    // Faint guide arc.
    ctx.save();
    ctx.globalAlpha = 0.1 * fade * dim;
    ctx.strokeStyle = `rgb(${core})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.stroke();
    ctx.restore();

    // Flowing particles along the quadratic Bézier.
    const phase = (now / 720 + beam.seed) % 1;
    for (let i = 0; i < BEAM_PARTICLES; i++) {
      const p = (phase + i / BEAM_PARTICLES) % 1;
      const inv = 1 - p;
      const px = inv * inv * ax + 2 * inv * p * cx + p * p * bx;
      const py = inv * inv * ay + 2 * inv * p * cy + p * p * by;
      // Lerp red/purple → green as the bubble nears the token; grow then shrink.
      const g = Math.round(68 + p * (255 - 68));
      const colr = beam.isPurple ? `${Math.round(167 - p * 167)},${Math.round(139 + p * 78)},${Math.round(250 - p * 185)}` : `${Math.round(239 - p * 239)},${g},${Math.round(68 + p * 0)}`;
      const r = (1.4 + 1.6 * Math.sin(p * Math.PI)) ;
      ctx.globalAlpha = (0.85 * Math.sin(p * Math.PI) + 0.15) * fade * dim;
      ctx.fillStyle = `rgb(${colr})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawNodes(ctx: CanvasRenderingContext2D, nodes: SimNode[], hover: SimNode | null, zoom: number, now: number, mono: string, focus: Set<string>, hot: Map<string, number>, images: Map<string, HTMLImageElement | null>): void {
  const nowMs = Date.now();
  const focusing = focus.size > 0;
  for (const n of nodes) {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    // A node added mid-frame seeds NaN until the sim ticks; non-finite coords make
    // the radial-gradient calls below throw, so skip until it has a real position.
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const dimmed = focusing && !focus.has(n.id);
    ctx.globalAlpha = dimmed ? 0.18 : 1;

    if (n.kind === 'cabal' && n.cabal) {
      const color = cabalColor(n.cabal);
      const pulse = 0.85 + 0.15 * Math.sin(now / 900 + x); // slow, desynced breathing
      const glow = ctx.createRadialGradient(x, y, 0, x, y, n.r * 2.4);
      glow.addColorStop(0, color === CABAL_RED ? 'rgba(239,68,68,0.28)' : 'rgba(167,139,250,0.26)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, n.r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, n.r * pulse, 0, Math.PI * 2);
      ctx.fillStyle = color === CABAL_RED ? 'rgba(127,29,29,0.9)' : 'rgba(76,53,117,0.9)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = n === hover ? 2 : 1.2;
      ctx.stroke();

      if (!dimmed) {
        ctx.textAlign = 'center';
        // Crew id + how many tokens it controls: the headline fact, always on.
        const label = `C-${n.id.slice(0, 4).toUpperCase()} · ${n.cabal.tokenCount}`;
        ctx.font = `700 9.5px ${mono}`;
        // Dark pill behind the text so it stays legible over the busy field.
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(5,5,8,0.6)';
        ctx.fillRect(x - tw / 2 - 3, y + n.r + 5, tw + 6, 12);
        ctx.fillStyle = 'rgba(245,245,245,0.92)';
        ctx.fillText(label, x, y + n.r + 14);
        if (n.cabal.estExtractedUsd > 0) {
          ctx.font = `600 8.5px ${mono}`;
          ctx.fillStyle = 'rgba(239,68,68,0.9)';
          ctx.fillText(`${formatUsd(n.cabal.estExtractedUsd)} extracted`, x, y + n.r + 25);
        }
      }
      ctx.globalAlpha = 1;
      continue;
    }

    // Token / spawn dot
    const status: AtlasTokenStatus | 'spawn' = n.kind === 'spawn' ? 'spawn' : (n.token?.status ?? 'watching');
    const color = status === 'spawn' ? SPAWN_COLOR : STATUS_COLORS[status];
    let alpha = 1;
    if (n.kind === 'spawn' && n.bornAt) {
      const age = nowMs - n.bornAt;
      alpha = age < 400 ? age / 400 : Math.max(0.25, 1 - age / SPAWN_TTL_MS);
    }
    if (status === 'dead') alpha = 0.55;
    // Outer-ring (unaffiliated trending) tokens recede so the cabal systems own
    // attention; they're ambient ecosystem context, not the subject.
    const outer = isOuterRing(n);
    if (outer && status !== 'spawn') alpha *= 0.5;

    const focused = focusing && focus.has(n.id);
    // Feeding pulse: a token actively receiving crew buys gets a green breathing
    // halo + expanding ring, decaying over TOKEN_HOT_MS. This is the "alive" tell.
    const hotAt = hot.get(n.id);
    if (hotAt !== undefined && !dimmed) {
      const hotT = (nowMs - hotAt) / TOKEN_HOT_MS;
      if (hotT >= 0 && hotT <= 1) {
        const halo = ctx.createRadialGradient(x, y, 0, x, y, n.r * 4);
        halo.addColorStop(0, `rgba(0,255,65,${0.22 * (1 - hotT)})`);
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, n.r * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(0,255,65,${0.5 * (1 - hotT)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, n.r + 3 + hotT * 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = dimmed ? 0.18 : alpha;
    // Focused tokens get a halo so the crew's constellation reads at a glance.
    if (focused) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, n.r * 3);
      halo.addColorStop(0, 'rgba(239,68,68,0.3)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, n.r * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Token logo, clipped to a circle, when loaded; else the status-colored dot.
    const logo = n.kind === 'token' ? images.get(n.id) : null;
    const drawR = focused ? n.r + 1 : n.r;
    if (logo) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, drawR, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(logo, x - drawR, y - drawR, drawR * 2, drawR * 2);
      ctx.restore();
      // Status ring around the logo so alive/rugged/dead still reads.
      ctx.beginPath();
      ctx.arc(x, y, drawR, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, drawR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (status === 'rugged') {
      ctx.strokeStyle = 'rgba(239,68,68,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, n.r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Linked (crew-controlled) tokens label at a low zoom so the systems read;
    // unaffiliated outer-ring tokens only label on hover/focus to cut noise.
    const labelThreshold = n.linked ? 1.05 : 1.8;
    if (n === hover || focused || (zoom >= labelThreshold && n.symbol && !dimmed)) {
      ctx.font = `500 8.5px ${mono}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = outer ? 'rgba(150,150,160,0.75)' : 'rgba(200,200,210,0.95)';
      ctx.fillText(n.symbol ?? `${n.id.slice(0, 4)}…`, x, y - n.r - 5);
    }
    ctx.globalAlpha = 1;
  }
}

function drawHoverChip(ctx: CanvasRenderingContext2D, hover: SimNode | null, zoom: number, mono: string): void {
  if (!hover) return;
  const x = hover.x ?? 0;
  const y = hover.y ?? 0;
  const lines: string[] = [];
  if (hover.kind === 'cabal' && hover.cabal) {
    lines.push(`${hover.cabal.tokenCount} TOKEN${hover.cabal.tokenCount === 1 ? '' : 'S'} · ${hover.cabal.walletCount} WALLETS`);
    if (hover.cabal.ruggedCount > 0) lines.push(`${hover.cabal.ruggedCount} RUGGED · ${formatUsd(hover.cabal.estExtractedUsd)} EXTRACTED`);
  } else if (hover.token) {
    lines.push(hover.token.status.toUpperCase() + (hover.token.liquidityUsd ? ` · ${formatUsd(hover.token.liquidityUsd)} LIQ` : ''));
  } else if (hover.kind === 'spawn') {
    lines.push('JUST LAUNCHED');
  }
  if (lines.length === 0) return;

  ctx.save();
  // Chip renders at constant screen size regardless of zoom.
  ctx.font = `500 ${9 / zoom}px ${mono}`;
  const padX = 6 / zoom;
  const lineH = 13 / zoom;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const cx = x + (hover.r + 10) / zoom;
  const cy = y - ((lines.length * lineH) / 2);
  ctx.fillStyle = 'rgba(9,9,14,0.88)';
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.roundRect(cx, cy - lineH * 0.75, widest + padX * 2, lines.length * lineH + padX, 3 / zoom);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(220,220,228,0.92)';
  ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, cx + padX, cy + i * lineH));
  ctx.restore();
}
