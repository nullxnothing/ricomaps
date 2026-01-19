'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Line, Text } from '@react-three/drei';
import * as THREE from 'three';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force-3d';
import { GraphData, GraphNode, GraphLink } from '@/lib/types';
import { analyzeGraph, AnalyzedNode, findLinkedComponents, areInSameComponent } from '@/lib/graph-analysis';

interface ForensicGraph3DProps {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  onGraphUpdate?: (data: GraphData) => void;
}

// Forensic role classification
type ForensicRole = 'cex' | 'funder' | 'bot' | 'victim' | 'holder' | 'token' | 'cabal' | 'hub' | 'unknown';

interface SimNode extends AnalyzedNode {
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
  index?: number;
  forensicRole: ForensicRole;
  riskScore: number;
}

interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
  value: number;
  suspicious?: boolean;
  index?: number;
}

// Clean cyberpunk palette - no excessive glow
const COLORS = {
  bg: '#0a0a0a',

  // Node fills by role
  node: {
    cex: '#4a9eff',
    funder: '#5b8def',
    bot: '#7c5cbf',
    victim: '#ef4444',
    holder: '#4a5568',
    token: '#f59e0b',
    cabal: '#ff3366',
    hub: '#f59e0b',
    unknown: '#374151',
  },

  // Subtle edges
  edge: {
    normal: '#1f2937',
    suspicious: '#ff3366',
    hover: '#4a9eff',
  },

  // Neon accents - used sparingly
  accent: {
    red: '#ff3366',
    blue: '#4a9eff',
    amber: '#f59e0b',
  },
};

// Determine forensic role from node
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

// Calculate risk score
function calculateRiskScore(node: AnalyzedNode): number {
  let score = 0;
  if (node.type === 'cabal-funder' || node.visualCategory === 'cabal') score += 80;
  else if (node.metadata?.suspicious) score += 60;
  else if (node.visualCategory === 'hub') score += 40;
  else if (node.type === 'funder') score += 20;
  if (node.degreeCount > 5) score += 15;
  if (node.metadata?.fundedCount && node.metadata.fundedCount > 3) score += 20;
  return Math.min(100, score);
}

// Get node size based on role and risk
function getNodeSize(role: ForensicRole, riskScore: number): number {
  const baseSize: Record<ForensicRole, number> = {
    token: 2.5,
    cabal: 1.8,
    hub: 1.6,
    victim: 1.4,
    funder: 1.2,
    cex: 1.2,
    bot: 1.0,
    holder: 0.8,
    unknown: 0.8,
  };
  const base = baseSize[role] || 1;
  const riskMultiplier = 1 + (riskScore / 200);
  return base * riskMultiplier;
}

// 3D shape component based on forensic role
function ForensicNode({
  node,
  onClick,
  onHover,
}: {
  node: SimNode;
  onClick?: (node: GraphNode) => void;
  onHover?: (node: GraphNode | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const size = getNodeSize(node.forensicRole, node.riskScore);
  const color = COLORS.node[node.forensicRole];
  const isHighRisk = node.riskScore >= 60;

  useFrame(() => {
    if (meshRef.current && node.x !== undefined && node.y !== undefined && node.z !== undefined) {
      meshRef.current.position.set(node.x, node.y, node.z);

      // Subtle rotation for high-risk nodes
      if (isHighRisk) {
        meshRef.current.rotation.y += 0.005;
      }
    }
  });

  const handleClick = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onClick?.(node);
  }, [node, onClick]);

  const handlePointerOver = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setHovered(true);
    onHover?.(node);
    document.body.style.cursor = 'pointer';
  }, [node, onHover]);

  const handlePointerOut = useCallback(() => {
    setHovered(false);
    onHover?.(null);
    document.body.style.cursor = 'grab';
  }, [onHover]);

  // Render different 3D shapes based on forensic role
  const renderShape = () => {
    const hoverScale = hovered ? 1.2 : 1;
    const scale = size * hoverScale;

    const commonProps = {
      ref: meshRef,
      onClick: handleClick,
      onPointerOver: handlePointerOver,
      onPointerOut: handlePointerOut,
      position: [node.x || 0, node.y || 0, node.z || 0] as [number, number, number],
    };

    switch (node.forensicRole) {
      case 'cex':
      case 'funder':
        // Cube for funders/CEX
        return (
          <mesh {...commonProps}>
            <boxGeometry args={[scale, scale, scale]} />
            <meshStandardMaterial
              color={color}
              emissive={hovered ? color : '#000000'}
              emissiveIntensity={hovered ? 0.3 : 0}
              metalness={0.3}
              roughness={0.7}
            />
          </mesh>
        );

      case 'bot':
      case 'holder':
        // Sphere for bots/holders
        return (
          <mesh {...commonProps}>
            <sphereGeometry args={[scale * 0.6, 24, 24]} />
            <meshStandardMaterial
              color={color}
              emissive={hovered ? color : '#000000'}
              emissiveIntensity={hovered ? 0.3 : 0}
              metalness={0.2}
              roughness={0.8}
            />
          </mesh>
        );

      case 'victim':
        // Cone/Triangle for victim
        return (
          <mesh {...commonProps} rotation={[0, 0, Math.PI]}>
            <coneGeometry args={[scale * 0.6, scale * 1.2, 3]} />
            <meshStandardMaterial
              color={color}
              emissive={hovered ? color : '#000000'}
              emissiveIntensity={hovered ? 0.4 : 0}
              metalness={0.3}
              roughness={0.6}
            />
          </mesh>
        );

      case 'token':
        // Icosahedron for token center
        return (
          <mesh {...commonProps}>
            <icosahedronGeometry args={[scale * 0.8, 0]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.4}
              metalness={0.5}
              roughness={0.3}
            />
          </mesh>
        );

      case 'cabal':
        // Octahedron for cabal - distinct and threatening
        return (
          <group>
            <mesh {...commonProps}>
              <octahedronGeometry args={[scale * 0.7, 0]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.5}
                metalness={0.4}
                roughness={0.4}
              />
            </mesh>
            {/* Subtle outer ring for cabal nodes */}
            <mesh position={[node.x || 0, node.y || 0, node.z || 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[scale * 1.2, 0.05, 8, 32]} />
              <meshBasicMaterial color={COLORS.accent.red} transparent opacity={0.6} />
            </mesh>
          </group>
        );

      case 'hub':
        // Dodecahedron for hub nodes
        return (
          <mesh {...commonProps}>
            <dodecahedronGeometry args={[scale * 0.6, 0]} />
            <meshStandardMaterial
              color={color}
              emissive={hovered ? color : '#000000'}
              emissiveIntensity={hovered ? 0.4 : 0.2}
              metalness={0.4}
              roughness={0.5}
            />
          </mesh>
        );

      default:
        // Default sphere
        return (
          <mesh {...commonProps}>
            <sphereGeometry args={[scale * 0.5, 16, 16]} />
            <meshStandardMaterial
              color={color}
              metalness={0.2}
              roughness={0.8}
            />
          </mesh>
        );
    }
  };

  return renderShape();
}

// Directed edge with arrow
function DirectedEdge({
  link,
  nodes,
}: {
  link: SimLink;
  nodes: SimNode[];
}) {
  const sourceNode = useMemo(() => {
    const sourceId = typeof link.source === 'string' ? link.source : link.source?.id;
    return nodes.find(n => n.id === sourceId);
  }, [link.source, nodes]);

  const targetNode = useMemo(() => {
    const targetId = typeof link.target === 'string' ? link.target : link.target?.id;
    return nodes.find(n => n.id === targetId);
  }, [link.target, nodes]);

  const [points, setPoints] = useState<THREE.Vector3[]>([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 1, 1),
  ]);

  // Calculate line width based on volume
  const lineWidth = useMemo(() => {
    const vol = link.value || 0;
    if (vol >= 20) return 2;
    if (vol >= 5) return 1.5;
    if (vol >= 1) return 1;
    return 0.5;
  }, [link.value]);

  const color = link.suspicious ? COLORS.edge.suspicious : COLORS.edge.normal;

  useFrame(() => {
    if (!sourceNode || !targetNode) return;
    if (sourceNode.x === undefined || targetNode.x === undefined) return;

    const start = new THREE.Vector3(sourceNode.x, sourceNode.y || 0, sourceNode.z || 0);
    const end = new THREE.Vector3(targetNode.x, targetNode.y || 0, targetNode.z || 0);

    // Shorten the line to not overlap with nodes
    const direction = end.clone().sub(start).normalize();
    const targetSize = getNodeSize(targetNode.forensicRole, targetNode.riskScore);
    const adjustedEnd = end.clone().sub(direction.multiplyScalar(targetSize * 1.5));

    setPoints([start, adjustedEnd]);
  });

  if (!sourceNode || !targetNode) return null;

  return (
    <Line
      points={points}
      color={color}
      lineWidth={lineWidth}
      transparent
      opacity={link.suspicious ? 0.8 : 0.4}
    />
  );
}

// Cluster boundary visualization
function ClusterBoundary({
  nodes,
  color,
  label,
}: {
  nodes: SimNode[];
  color: string;
  label: string;
}) {
  const [center, setCenter] = useState(new THREE.Vector3(0, 0, 0));
  const [radius, setRadius] = useState(10);

  useFrame(() => {
    if (nodes.length === 0) return;

    let sumX = 0, sumY = 0, sumZ = 0;
    let maxDist = 0;

    nodes.forEach(n => {
      sumX += n.x || 0;
      sumY += n.y || 0;
      sumZ += n.z || 0;
    });

    const newCenter = new THREE.Vector3(
      sumX / nodes.length,
      sumY / nodes.length,
      sumZ / nodes.length
    );

    nodes.forEach(n => {
      const dist = new THREE.Vector3(n.x || 0, n.y || 0, n.z || 0).distanceTo(newCenter);
      if (dist > maxDist) maxDist = dist;
    });

    setCenter(newCenter);
    setRadius(Math.max(maxDist + 5, 10));
  });

  if (nodes.length < 2) return null;

  return (
    <group position={center}>
      {/* Dashed ring around cluster */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.1, 8, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} />
      </mesh>
      {/* Label - using default font */}
      <Text
        position={[0, radius + 3, 0]}
        fontSize={2}
        color={color}
        anchorX="center"
        anchorY="bottom"
      >
        {label}
      </Text>
    </group>
  );
}

// Camera auto-focus
function CameraController({ nodes }: { nodes: SimNode[] }) {
  const { camera } = useThree();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (nodes.length > 0 && !initialized) {
      // Find center of cabal nodes or all nodes
      const cabalNodes = nodes.filter(n => n.forensicRole === 'cabal' || n.forensicRole === 'hub');
      const targetNodes = cabalNodes.length > 0 ? cabalNodes : nodes;

      let sumX = 0, sumY = 0, sumZ = 0;
      targetNodes.forEach(n => {
        sumX += n.x || 0;
        sumY += n.y || 0;
        sumZ += n.z || 0;
      });

      const centerX = sumX / targetNodes.length;
      const centerY = sumY / targetNodes.length;
      const centerZ = sumZ / targetNodes.length;

      // Position camera to see the whole graph
      const distance = Math.sqrt(nodes.length) * 20;
      camera.position.set(centerX + distance, centerY + distance * 0.5, centerZ + distance);
      camera.lookAt(centerX, centerY, centerZ);

      setInitialized(true);
    }
  }, [nodes, camera, initialized]);

  return null;
}

// Main scene
function Scene({
  data,
  onNodeClick,
  onNodeHover,
}: {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
}) {
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const simulationRef = useRef<ReturnType<typeof forceSimulation> | null>(null);
  const tickCountRef = useRef(0);
  const baseDataIdRef = useRef<string>(''); // Track base scan ID (first node)
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map()); // Keep track of existing node positions

  // Base data ID - only changes on new scan, not incremental streaming updates
  const baseDataId = useMemo(() => {
    // Use first node ID as the "base" - this only changes on new scans
    return data.nodes[0]?.id || '';
  }, [data.nodes]);

  // Initialize or update simulation
  useEffect(() => {
    if (!data || data.nodes.length === 0) return;

    const isNewScan = baseDataId !== baseDataIdRef.current;
    baseDataIdRef.current = baseDataId;

    // Get existing node positions to preserve them
    const existingPositions = nodeMapRef.current;

    const analyzedNodes = analyzeGraph(data.nodes, data.links);
    const componentMap = findLinkedComponents(data.nodes, data.links);

    const nodeCount = data.nodes.length;
    const spread = Math.max(100, Math.sqrt(nodeCount) * 15);

    // Create simNodes, preserving positions for existing nodes
    const simNodes: SimNode[] = analyzedNodes.map((n) => {
      const existing = existingPositions.get(n.id);
      const forensicRole = getForensicRole(n);
      const riskScore = calculateRiskScore(n);

      if (existing && !isNewScan) {
        // Preserve existing position for incremental updates
        return {
          ...n,
          x: existing.x,
          y: existing.y,
          z: existing.z,
          vx: existing.vx || 0,
          vy: existing.vy || 0,
          vz: existing.vz || 0,
          forensicRole,
          riskScore,
        };
      } else {
        // New node - find position near a linked node or random
        let initialX = (Math.random() - 0.5) * spread;
        let initialY = (Math.random() - 0.5) * spread;
        let initialZ = (Math.random() - 0.5) * spread;

        // For incremental updates, position near a linked node
        if (!isNewScan) {
          const linkedLink = data.links.find(l => l.source === n.id || l.target === n.id);
          if (linkedLink) {
            const linkedId = linkedLink.source === n.id ? linkedLink.target : linkedLink.source;
            const linkedNode = existingPositions.get(linkedId as string);
            if (linkedNode && linkedNode.x !== undefined) {
              // Position near the linked node with some offset
              initialX = linkedNode.x + (Math.random() - 0.5) * 30;
              initialY = linkedNode.y! + (Math.random() - 0.5) * 30;
              initialZ = linkedNode.z! + (Math.random() - 0.5) * 30;
            }
          }
        }

        return {
          ...n,
          x: initialX,
          y: initialY,
          z: initialZ,
          forensicRole,
          riskScore,
        };
      }
    });

    // Update the node map
    const tempNodeMap = new Map<string, SimNode>();
    simNodes.forEach(n => tempNodeMap.set(n.id, n));
    nodeMapRef.current = tempNodeMap;

    const simLinks: SimLink[] = data.links.map((l) => ({
      source: l.source,
      target: l.target,
      value: l.value,
      suspicious: l.suspicious,
    }));

    // Stop existing simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const simulation = forceSimulation(simNodes as any, 3)
      .force(
        'link',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        forceLink(simLinks as any)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .id((d: any) => d.id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .distance((link: any) => {
            if (link.suspicious) return 25;
            const sourceNode = typeof link.source === 'string' ? tempNodeMap.get(link.source) : link.source;
            const targetNode = typeof link.target === 'string' ? tempNodeMap.get(link.target) : link.target;
            if (sourceNode && targetNode) {
              const sameComponent = areInSameComponent(sourceNode.id, targetNode.id, componentMap);
              return sameComponent ? 40 : 80;
            }
            return 50;
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .strength((link: any) => link.suspicious ? 0.9 : 0.6)
      )
      .force(
        'charge',
        forceManyBody()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .strength((d: any) => {
            if (d.forensicRole === 'cabal') return -200;
            if (d.forensicRole === 'hub') return -150;
            if (d.forensicRole === 'token') return -250;
            if (!d.isLinked) return -30;
            return -80;
          })
          .distanceMax(300)
      )
      .force('center', forceCenter(0, 0, 0).strength(0.05))
      .force(
        'collide',
        forceCollide()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .radius((d: any) => getNodeSize(d.forensicRole, d.riskScore) * 3)
          .strength(0.8)
      )
      .alphaDecay(isNewScan ? 0.02 : 0.05) // Faster decay for incremental updates
      .velocityDecay(0.4);

    simulationRef.current = simulation;

    // For incremental updates, less warmup since positions are preserved
    const warmupTicks = isNewScan ? 100 : 20;
    tickCountRef.current = isNewScan ? 0 : 150; // Skip more animation for incremental

    for (let i = 0; i < warmupTicks; i++) {
      simulation.tick();
    }

    // Update node map with final positions
    simNodes.forEach(n => nodeMapRef.current.set(n.id, n));

    setNodes([...simNodes]);
    setLinks([...simLinks]);

    return () => {
      simulation.stop();
    };
  }, [baseDataId, data]);

  // Animation loop
  useFrame(() => {
    if (simulationRef.current && tickCountRef.current < 200) {
      simulationRef.current.tick();
      tickCountRef.current++;

      if (tickCountRef.current % 5 === 0) {
        setNodes(prev => {
          // Update nodeMapRef with current positions for next incremental update
          prev.forEach(n => {
            if (n.x !== undefined) {
              nodeMapRef.current.set(n.id, n);
            }
          });
          return [...prev];
        });
      }
    }
  });

  // Identify clusters
  const cabalClusterNodes = useMemo(() => {
    return nodes.filter(n => n.forensicRole === 'cabal' || n.metadata?.suspicious);
  }, [nodes]);

  return (
    <>
      {/* Lighting - clean, not dramatic */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 50, 50]} intensity={0.6} />
      <directionalLight position={[-50, -50, -50]} intensity={0.3} color="#4a9eff" />

      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        rotateSpeed={0.5}
        zoomSpeed={1.0}
        minDistance={20}
        maxDistance={500}
      />

      <CameraController nodes={nodes} />

      {/* Cluster boundaries */}
      {cabalClusterNodes.length >= 2 && (
        <ClusterBoundary
          nodes={cabalClusterNodes}
          color={COLORS.accent.red}
          label="CABAL CLUSTER"
        />
      )}

      {/* Edges */}
      {links.map((link, i) => (
        <DirectedEdge key={`edge-${i}`} link={link} nodes={nodes} />
      ))}

      {/* Nodes */}
      {nodes.map((node) => (
        <ForensicNode
          key={node.id}
          node={node}
          onClick={onNodeClick}
          onHover={onNodeHover}
        />
      ))}
    </>
  );
}

// Main component
export function ForensicGraph3D({ data, onNodeClick, onNodeHover }: ForensicGraph3DProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[#4b5563] font-mono text-sm">INITIALIZING...</div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[#4b5563] font-mono text-sm">NO DATA</div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#0a0a0a]">
      <Canvas
        camera={{ position: [0, 0, 150], fov: 60, near: 0.1, far: 2000 }}
        style={{ background: COLORS.bg }}
        gl={{ antialias: true, alpha: false }}
      >
        <Scene data={data} onNodeClick={onNodeClick} onNodeHover={onNodeHover} />
      </Canvas>
    </div>
  );
}

// Legend item
function LegendItem({ shape, color, label }: { shape: string; color: string; label: string }) {
  const ShapeIcon = () => {
    const size = 10;

    switch (shape) {
      case 'cube':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <rect x="1" y="1" width="8" height="8" fill={color} />
          </svg>
        );
      case 'sphere':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" fill={color} />
          </svg>
        );
      case 'cone':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="5,1 9,9 1,9" fill={color} />
          </svg>
        );
      case 'octahedron':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="5,0 10,5 5,10 0,5" fill={color} />
          </svg>
        );
      case 'dodecahedron':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="3,0 7,0 10,3 10,7 7,10 3,10 0,7 0,3" fill={color} />
          </svg>
        );
      case 'star':
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <polygon points="5,0 6,4 10,4 7,6 8,10 5,8 2,10 3,6 0,4 4,4" fill={color} />
          </svg>
        );
      default:
        return (
          <svg width={size} height={size} viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="4" fill={color} />
          </svg>
        );
    }
  };

  return (
    <div className="flex items-center gap-2">
      <ShapeIcon />
      <span className="text-[#6b7280]">{label}</span>
    </div>
  );
}

export default ForensicGraph3D;
