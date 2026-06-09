/**
 * Graph Analysis Utilities
 *
 * Provides cluster detection and degree centrality calculations
 * to enhance visual hierarchy in the graph visualization.
 */

import { GraphNode, GraphLink } from './types';

export type VisualCategory = 'unlinked' | 'linked' | 'hub' | 'cabal';

export interface EnhancedNodeAttributes {
  isLinked: boolean;
  componentId: string;
  degreeCount: number;
  visualCategory: VisualCategory;
}

export interface AnalyzedNode extends GraphNode, EnhancedNodeAttributes {}

/**
 * Union-Find data structure for efficient component detection.
 * Exported for reuse by the behavioral clusterer.
 */
export class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(x: string, y: string): void {
    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX) || 0;
    const rankY = this.rank.get(rootY) || 0;

    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }
}

/**
 * Find connected components in the graph using Union-Find algorithm
 * Returns a map from nodeId to componentId
 */
export function findLinkedComponents(
  nodes: GraphNode[],
  links: GraphLink[]
): Map<string, string> {
  const uf = new UnionFind();

  // Initialize all nodes
  nodes.forEach(node => uf.find(node.id));

  // Union connected nodes
  links.forEach(link => {
    const sourceId = typeof link.source === 'string' ? link.source : String(link.source);
    const targetId = typeof link.target === 'string' ? link.target : String(link.target);
    uf.union(sourceId, targetId);
  });

  // Build component map
  const componentMap = new Map<string, string>();
  nodes.forEach(node => {
    componentMap.set(node.id, uf.find(node.id));
  });

  return componentMap;
}

/**
 * Calculate degree centrality (number of connections) for each node
 */
export function calculateDegreeCentrality(
  nodes: GraphNode[],
  links: GraphLink[]
): Map<string, number> {
  const degreeMap = new Map<string, number>();

  // Initialize all nodes with 0 degree
  nodes.forEach(node => degreeMap.set(node.id, 0));

  // Count connections
  links.forEach(link => {
    const sourceId = typeof link.source === 'string' ? link.source : String(link.source);
    const targetId = typeof link.target === 'string' ? link.target : String(link.target);

    degreeMap.set(sourceId, (degreeMap.get(sourceId) || 0) + 1);
    degreeMap.set(targetId, (degreeMap.get(targetId) || 0) + 1);
  });

  return degreeMap;
}

/**
 * Get the size of each component
 */
function getComponentSizes(componentMap: Map<string, string>): Map<string, number> {
  const sizes = new Map<string, number>();

  componentMap.forEach((componentId) => {
    sizes.set(componentId, (sizes.get(componentId) || 0) + 1);
  });

  return sizes;
}

/**
 * Determine visual category for a node based on its properties and graph structure
 */
function determineVisualCategory(
  node: GraphNode,
  isLinked: boolean,
  degreeCount: number,
  componentSize: number
): VisualCategory {
  // Cabal-funder nodes always get the cabal category
  if (node.type === 'cabal-funder' || node.metadata?.suspicious) {
    return 'cabal';
  }

  // Unlinked nodes (isolated or in very small components)
  if (!isLinked || componentSize <= 1) {
    return 'unlinked';
  }

  // Hub nodes have high degree centrality (4+ connections)
  if (degreeCount >= 4) {
    return 'hub';
  }

  // Regular linked nodes
  return 'linked';
}

/**
 * Main analysis function - enhances nodes with visual hierarchy attributes
 */
export function analyzeGraph(
  nodes: GraphNode[],
  links: GraphLink[]
): AnalyzedNode[] {
  if (nodes.length === 0) return [];

  const componentMap = findLinkedComponents(nodes, links);
  const componentSizes = getComponentSizes(componentMap);
  const degreeMap = calculateDegreeCentrality(nodes, links);

  return nodes.map(node => {
    const componentId = componentMap.get(node.id) || node.id;
    const componentSize = componentSizes.get(componentId) || 1;
    const degreeCount = degreeMap.get(node.id) || 0;
    const isLinked = componentSize > 1;

    const visualCategory = determineVisualCategory(
      node,
      isLinked,
      degreeCount,
      componentSize
    );

    return {
      ...node,
      isLinked,
      componentId,
      degreeCount,
      visualCategory,
    };
  });
}

/**
 * Check if two nodes are in the same component
 */
export function areInSameComponent(
  nodeA: string,
  nodeB: string,
  componentMap: Map<string, string>
): boolean {
  const compA = componentMap.get(nodeA);
  const compB = componentMap.get(nodeB);
  return compA !== undefined && compA === compB;
}

/**
 * Get graph statistics for display
 */
export interface GraphStats {
  totalNodes: number;
  isolatedNodes: number;
  clusteredNodes: number;
  hubNodes: number;
  cabalNodes: number;
  componentCount: number;
  largestComponentSize: number;
  avgDegree: number;
}

export function calculateGraphStats(analyzedNodes: AnalyzedNode[]): GraphStats {
  if (analyzedNodes.length === 0) {
    return {
      totalNodes: 0,
      isolatedNodes: 0,
      clusteredNodes: 0,
      hubNodes: 0,
      cabalNodes: 0,
      componentCount: 0,
      largestComponentSize: 0,
      avgDegree: 0,
    };
  }

  const components = new Set<string>();
  const componentSizes = new Map<string, number>();

  let isolatedNodes = 0;
  let clusteredNodes = 0;
  let hubNodes = 0;
  let cabalNodes = 0;
  let totalDegree = 0;

  analyzedNodes.forEach(node => {
    components.add(node.componentId);
    componentSizes.set(node.componentId, (componentSizes.get(node.componentId) || 0) + 1);
    totalDegree += node.degreeCount;

    switch (node.visualCategory) {
      case 'unlinked':
        isolatedNodes++;
        break;
      case 'linked':
        clusteredNodes++;
        break;
      case 'hub':
        hubNodes++;
        break;
      case 'cabal':
        cabalNodes++;
        break;
    }
  });

  const largestComponentSize = Math.max(...componentSizes.values());

  return {
    totalNodes: analyzedNodes.length,
    isolatedNodes,
    clusteredNodes,
    hubNodes,
    cabalNodes,
    componentCount: components.size,
    largestComponentSize,
    avgDegree: totalDegree / analyzedNodes.length,
  };
}
