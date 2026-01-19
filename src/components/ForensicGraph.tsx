'use client';

import { useRef, useEffect, useCallback, useMemo } from 'react';
import cytoscape, { Core, NodeSingular, EdgeSingular } from 'cytoscape';
// @ts-expect-error - cytoscape-cola doesn't have types
import cola from 'cytoscape-cola';
import { GraphData, GraphNode, GraphLink } from '@/lib/types';
import { analyzeGraph, AnalyzedNode, findLinkedComponents } from '@/lib/graph-analysis';

// Register cola layout
if (typeof window !== 'undefined') {
  cytoscape.use(cola);
}

interface ForensicGraphProps {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
}

// Forensic role types for visual distinction
type ForensicRole = 'cex' | 'funder' | 'bot' | 'victim' | 'holder' | 'token' | 'cabal' | 'hub' | 'unknown';

// Map node types to forensic roles
function getForensicRole(node: AnalyzedNode): ForensicRole {
  if (node.type === 'token') return 'token';
  if (node.type === 'cabal-funder' || node.visualCategory === 'cabal' || node.metadata?.suspicious) return 'cabal';
  if (node.visualCategory === 'hub') return 'hub';
  if (node.type === 'target') return 'victim';
  if (node.type === 'funder') return 'funder';
  if (node.type === 'funded') return 'bot';
  if (node.type === 'holder') return 'holder';
  if (node.type === 'connected') return 'bot';
  return 'unknown';
}

// Calculate risk score (0-100) based on node properties
function calculateRiskScore(node: AnalyzedNode): number {
  let score = 0;

  // Base score from type
  if (node.type === 'cabal-funder' || node.visualCategory === 'cabal') score += 80;
  else if (node.metadata?.suspicious) score += 60;
  else if (node.visualCategory === 'hub') score += 40;
  else if (node.type === 'funder') score += 20;

  // Additional factors
  if (node.degreeCount > 5) score += 15;
  if (node.metadata?.fundedCount && node.metadata.fundedCount > 3) score += 20;

  return Math.min(100, score);
}

// Color palette - Cyberpunk with restraint
const COLORS = {
  // Background
  bg: '#0a0a0a',
  bgSubtle: '#111114',

  // Node colors by role
  node: {
    cex: '#4a9eff',      // Cold blue - exchange/institutional
    funder: '#64b5f6',   // Soft blue - regular funders
    bot: '#8b5cf6',      // Purple - automated/bot wallets
    victim: '#ef4444',   // Red - target/victim
    holder: '#6b7280',   // Gray - regular holders
    token: '#fbbf24',    // Gold - token center
    cabal: '#ff3366',    // Hot pink - cabal nodes
    hub: '#f59e0b',      // Amber - hub nodes
    unknown: '#4b5563',  // Dark gray
  },

  // Edge colors
  edge: {
    normal: '#2a2a35',
    suspicious: '#ff3366',
    highlighted: '#4a9eff',
  },

  // Accent for high-risk
  neon: {
    red: '#ff3366',
    blue: '#4a9eff',
    amber: '#f59e0b',
  },

  // Cluster backgrounds
  cluster: {
    cabal: 'rgba(255, 51, 102, 0.08)',
    hub: 'rgba(245, 158, 11, 0.05)',
  },
};

// Shape mapping for forensic roles
const SHAPES: Record<ForensicRole, string> = {
  cex: 'rectangle',        // Square = CEX/Funder
  funder: 'diamond',       // Diamond = Regular funder
  bot: 'ellipse',          // Circle = Bot wallet
  victim: 'triangle',      // Triangle = Victim
  holder: 'ellipse',       // Circle = Holder
  token: 'star',           // Star = Token
  cabal: 'hexagon',        // Hexagon = Cabal
  hub: 'octagon',          // Octagon = Hub
  unknown: 'ellipse',
};

// Build Cytoscape stylesheet
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildStylesheet(): any[] {
  return [
    // Base node style
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'font-size': '10px',
        'font-family': 'JetBrains Mono, monospace',
        'color': '#6b7280',
        'text-margin-y': 8,
        'background-opacity': 0.9,
        'border-width': 1,
        'border-opacity': 0.8,
        'overlay-opacity': 0,
      },
    },
    // Role-specific styles
    ...Object.entries(SHAPES).map(([role, shape]) => ({
      selector: `node[role="${role}"]`,
      style: {
        'shape': shape as cytoscape.Css.NodeShape,
        'background-color': COLORS.node[role as ForensicRole],
        'border-color': COLORS.node[role as ForensicRole],
      },
    })),
    // Size based on risk score
    {
      selector: 'node[riskScore >= 0][riskScore < 30]',
      style: {
        'width': 24,
        'height': 24,
      },
    },
    {
      selector: 'node[riskScore >= 30][riskScore < 60]',
      style: {
        'width': 32,
        'height': 32,
        'border-width': 2,
      },
    },
    {
      selector: 'node[riskScore >= 60]',
      style: {
        'width': 40,
        'height': 40,
        'border-width': 2,
        'border-color': COLORS.neon.red,
        'border-opacity': 1,
      },
    },
    // Token node - always prominent
    {
      selector: 'node[role="token"]',
      style: {
        'width': 48,
        'height': 48,
        'border-width': 2,
        'border-color': COLORS.neon.amber,
        'font-size': '12px',
        'font-weight': 'bold',
        'color': COLORS.neon.amber,
      },
    },
    // Cabal nodes - neon accent
    {
      selector: 'node[role="cabal"]',
      style: {
        'border-width': 2,
        'border-color': COLORS.neon.red,
        'shadow-blur': 15,
        'shadow-color': COLORS.neon.red,
        'shadow-opacity': 0.4,
        'shadow-offset-x': 0,
        'shadow-offset-y': 0,
      },
    },
    // Hub nodes - subtle amber accent
    {
      selector: 'node[role="hub"]',
      style: {
        'border-width': 2,
        'border-color': COLORS.neon.amber,
      },
    },
    // Victim nodes
    {
      selector: 'node[role="victim"]',
      style: {
        'width': 36,
        'height': 36,
        'border-width': 2,
        'border-color': '#ef4444',
      },
    },
    // Hover state
    {
      selector: 'node:active, node:selected',
      style: {
        'border-width': 3,
        'border-color': COLORS.neon.blue,
        'overlay-opacity': 0,
      },
    },
    // Compound nodes (clusters)
    {
      selector: ':parent',
      style: {
        'background-opacity': 0.05,
        'background-color': '#ff3366',
        'border-width': 1,
        'border-color': 'rgba(255, 51, 102, 0.3)',
        'border-style': 'dashed',
        'padding': 20,
        'label': 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'font-size': '11px',
        'color': 'rgba(255, 51, 102, 0.6)',
      },
    },
    // Base edge style - thin crisp lines
    {
      selector: 'edge',
      style: {
        'width': 1,
        'line-color': COLORS.edge.normal,
        'target-arrow-color': COLORS.edge.normal,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        'opacity': 0.6,
      },
    },
    // Edge width based on volume (data attribute)
    {
      selector: 'edge[volume >= 0][volume < 1]',
      style: { 'width': 1 },
    },
    {
      selector: 'edge[volume >= 1][volume < 5]',
      style: { 'width': 1.5 },
    },
    {
      selector: 'edge[volume >= 5][volume < 20]',
      style: { 'width': 2 },
    },
    {
      selector: 'edge[volume >= 20]',
      style: { 'width': 3 },
    },
    // Suspicious edges - red accent
    {
      selector: 'edge[suspicious]',
      style: {
        'line-color': COLORS.edge.suspicious,
        'target-arrow-color': COLORS.edge.suspicious,
        'opacity': 0.8,
        'width': 2,
      },
    },
    // Edge hover
    {
      selector: 'edge:active, edge:selected',
      style: {
        'line-color': COLORS.neon.blue,
        'target-arrow-color': COLORS.neon.blue,
        'opacity': 1,
        'width': 2,
      },
    },
    // Highlight connected nodes on hover
    {
      selector: '.highlighted',
      style: {
        'border-color': COLORS.neon.blue,
        'border-width': 3,
      },
    },
    {
      selector: '.dimmed',
      style: {
        'opacity': 0.2,
      },
    },
  ];
}

// Detect clusters for compound node grouping
function detectClusters(
  nodes: AnalyzedNode[],
  links: GraphLink[]
): Map<string, string> {
  const clusterMap = new Map<string, string>();
  const componentMap = findLinkedComponents(nodes, links);

  // Group cabal-connected nodes
  const cabalNodes = nodes.filter(
    n => n.visualCategory === 'cabal' || n.type === 'cabal-funder' || n.metadata?.suspicious
  );

  if (cabalNodes.length >= 2) {
    // Find nodes connected to multiple cabal nodes
    const cabalIds = new Set(cabalNodes.map(n => n.id));
    const connectedToCabal = new Map<string, Set<string>>();

    links.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source;
      const targetId = typeof link.target === 'string' ? link.target : link.target;

      if (cabalIds.has(sourceId)) {
        if (!connectedToCabal.has(targetId)) connectedToCabal.set(targetId, new Set());
        connectedToCabal.get(targetId)!.add(sourceId);
      }
      if (cabalIds.has(targetId)) {
        if (!connectedToCabal.has(sourceId)) connectedToCabal.set(sourceId, new Set());
        connectedToCabal.get(sourceId)!.add(targetId);
      }
    });

    // Assign to cabal cluster
    cabalNodes.forEach(n => clusterMap.set(n.id, 'cabal-cluster'));
    connectedToCabal.forEach((cabalConnections, nodeId) => {
      if (cabalConnections.size >= 2 && !cabalIds.has(nodeId)) {
        clusterMap.set(nodeId, 'cabal-cluster');
      }
    });
  }

  return clusterMap;
}

// Convert graph data to Cytoscape elements
function buildElements(data: GraphData): cytoscape.ElementDefinition[] {
  const elements: cytoscape.ElementDefinition[] = [];
  const analyzedNodes = analyzeGraph(data.nodes, data.links);
  const clusterMap = detectClusters(analyzedNodes, data.links);

  // Add cluster compound nodes
  const clusters = new Set(clusterMap.values());
  clusters.forEach(clusterId => {
    elements.push({
      data: {
        id: clusterId,
        label: clusterId === 'cabal-cluster' ? 'CABAL CLUSTER' : clusterId.toUpperCase(),
      },
    });
  });

  // Add nodes
  analyzedNodes.forEach(node => {
    const role = getForensicRole(node);
    const riskScore = calculateRiskScore(node);
    const parent = clusterMap.get(node.id);

    elements.push({
      data: {
        id: node.id,
        label: node.label || `${node.id.slice(0, 4)}...${node.id.slice(-4)}`,
        role,
        riskScore,
        type: node.type,
        solBalance: node.solBalance,
        tokenAmount: node.tokenAmount,
        degreeCount: node.degreeCount,
        ...(parent ? { parent } : {}),
        // Store original node for callbacks
        originalNode: node,
      },
    });
  });

  // Add edges
  data.links.forEach((link, index) => {
    const sourceId = typeof link.source === 'string' ? link.source : link.source;
    const targetId = typeof link.target === 'string' ? link.target : link.target;

    elements.push({
      data: {
        id: `edge-${index}`,
        source: sourceId,
        target: targetId,
        volume: link.value,
        suspicious: link.suspicious || false,
        txSignature: link.txSignature,
      },
    });
  });

  return elements;
}

export function ForensicGraph({ data, onNodeClick, onNodeHover }: ForensicGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  // Memoize elements to prevent unnecessary rebuilds
  const elements = useMemo(() => {
    if (!data || data.nodes.length === 0) return [];
    return buildElements(data);
  }, [data]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current || elements.length === 0) return;

    // Clean up existing instance
    if (cyRef.current) {
      cyRef.current.destroy();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: buildStylesheet(),
      layout: {
        name: 'cola',
        animate: true,
        animationDuration: 1000,
        maxSimulationTime: 4000,
        fit: true,
        padding: 50,
        nodeSpacing: 40,
        edgeLength: 150,
        convergenceThreshold: 0.01,
        avoidOverlap: true,
        handleDisconnected: true,
        randomize: false,
        infinite: false,
        ungrabifyWhileSimulating: false,
        edgeSymDiffLength: 100,
        edgeJaccardLength: 100,
      } as any,
      // Interaction settings
      minZoom: 0.1,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
    });

    cyRef.current = cy;

    // Event handlers
    cy.on('tap', 'node', (event) => {
      const node = event.target as NodeSingular;
      const originalNode = node.data('originalNode') as GraphNode;
      if (originalNode && onNodeClick) {
        onNodeClick(originalNode);
      }
    });

    cy.on('mouseover', 'node', (event) => {
      const node = event.target as NodeSingular;
      const originalNode = node.data('originalNode') as GraphNode;

      // Highlight connected elements
      const neighborhood = node.neighborhood().add(node);
      cy.elements().addClass('dimmed');
      neighborhood.removeClass('dimmed');
      node.addClass('highlighted');

      if (originalNode && onNodeHover) {
        onNodeHover(originalNode);
      }

      containerRef.current!.style.cursor = 'pointer';
    });

    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('dimmed highlighted');
      if (onNodeHover) {
        onNodeHover(null);
      }
      containerRef.current!.style.cursor = 'grab';
    });

    // Edge hover for tooltip
    cy.on('mouseover', 'edge', (event) => {
      const edge = event.target as EdgeSingular;
      edge.addClass('highlighted');
    });

    cy.on('mouseout', 'edge', (event) => {
      const edge = event.target as EdgeSingular;
      edge.removeClass('highlighted');
    });

    // Grabbing cursor
    cy.on('grab', 'node', () => {
      containerRef.current!.style.cursor = 'grabbing';
    });

    cy.on('free', 'node', () => {
      containerRef.current!.style.cursor = 'grab';
    });

    return () => {
      cy.destroy();
    };
  }, [elements, onNodeClick, onNodeHover]);

  // Fit to viewport helper
  const handleFit = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.fit(undefined, 50);
    }
  }, []);

  // Reset zoom helper
  const handleResetZoom = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.zoom(1);
      cyRef.current.center();
    }
  }, []);

  if (!data || data.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[#4b5563] font-mono text-sm">NO DATA</div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#0a0a0a]">
      {/* Graph container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ cursor: 'grab' }}
      />

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex gap-2">
        <button
          onClick={handleFit}
          className="px-3 py-1.5 bg-[#111114] border border-[#2a2a35] text-[#6b7280]
                     text-xs font-mono hover:border-[#4a9eff] hover:text-[#4a9eff]
                     transition-colors rounded"
        >
          FIT
        </button>
        <button
          onClick={handleResetZoom}
          className="px-3 py-1.5 bg-[#111114] border border-[#2a2a35] text-[#6b7280]
                     text-xs font-mono hover:border-[#4a9eff] hover:text-[#4a9eff]
                     transition-colors rounded"
        >
          RESET
        </button>
      </div>

      {/* Legend */}
      <div className="absolute top-4 left-4 bg-[#111114]/90 border border-[#2a2a35] rounded p-3">
        <div className="text-[10px] font-mono text-[#4b5563] mb-2 uppercase tracking-wider">Legend</div>
        <div className="space-y-1.5">
          <LegendItem shape="diamond" color={COLORS.node.funder} label="Funder" />
          <LegendItem shape="circle" color={COLORS.node.bot} label="Bot Wallet" />
          <LegendItem shape="triangle" color={COLORS.node.victim} label="Target" />
          <LegendItem shape="hexagon" color={COLORS.node.cabal} label="Cabal" />
          <LegendItem shape="octagon" color={COLORS.node.hub} label="Hub" />
          <LegendItem shape="star" color={COLORS.node.token} label="Token" />
        </div>
        <div className="mt-3 pt-2 border-t border-[#2a2a35]">
          <div className="text-[10px] font-mono text-[#4b5563] mb-1.5 uppercase tracking-wider">Edges</div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-[#6b7280]">
            <div className="w-4 h-px bg-[#2a2a35]" />
            <span>Normal</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-[#ff3366]">
            <div className="w-4 h-0.5 bg-[#ff3366]" />
            <span>Suspicious</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Legend item component
function LegendItem({ shape, color, label }: { shape: string; color: string; label: string }) {
  const ShapeIcon = () => {
    const size = 10;
    const style = { fill: color, stroke: color, strokeWidth: 1 };

    switch (shape) {
      case 'diamond':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="5,0 10,5 5,10 0,5" style={style} />
          </svg>
        );
      case 'circle':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" style={style} />
          </svg>
        );
      case 'triangle':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="5,0 10,10 0,10" style={style} />
          </svg>
        );
      case 'hexagon':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="3,0 7,0 10,5 7,10 3,10 0,5" style={style} />
          </svg>
        );
      case 'octagon':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="3,0 7,0 10,3 10,7 7,10 3,10 0,7 0,3" style={style} />
          </svg>
        );
      case 'star':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="5,0 6,4 10,4 7,6 8,10 5,8 2,10 3,6 0,4 4,4" style={style} />
          </svg>
        );
      default:
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <rect x="0" y="0" width="10" height="10" style={style} />
          </svg>
        );
    }
  };

  return (
    <div className="flex items-center gap-2">
      <ShapeIcon />
      <span className="text-[10px] font-mono text-[#6b7280]">{label}</span>
    </div>
  );
}

export default ForensicGraph;
