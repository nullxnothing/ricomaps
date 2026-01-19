'use client';

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceRadial } from 'd3-force-3d';
import { GraphData, GraphNode, NODE_COLORS } from '@/lib/types';
import { analyzeGraph, AnalyzedNode, findLinkedComponents, areInSameComponent } from '@/lib/graph-analysis';

interface Graph3DProps {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
}

// Extend GraphNode for simulation with visual hierarchy attributes
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
  radius?: number;
  entranceScale?: number;
}

interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
  value: number;
  suspicious?: boolean;
  index?: number;
}

// Visual hierarchy configuration - CLEAN style, no bloom
const VISUAL_CONFIG = {
  radius: {
    unlinked: 4,
    linked: 5,
    hub: 8,
    cabal: 10,
    token: 8,
    target: 6,
  },
  pulse: {
    unlinked: { speed: 0, amplitude: 0 },
    linked: { speed: 0, amplitude: 0 },
    hub: { speed: 0.5, amplitude: 0.02 },
    cabal: { speed: 0.8, amplitude: 0.03 },
  },
  // Clean solid style - no transparency mess
  bubble: {
    unlinked: { fillOpacity: 0.7, ringOpacity: 0.9, ringWidth: 0.12 },
    linked: { fillOpacity: 0.8, ringOpacity: 1.0, ringWidth: 0.1 },
    hub: { fillOpacity: 0.9, ringOpacity: 1.0, ringWidth: 0.08 },
    cabal: { fillOpacity: 0.9, ringOpacity: 1.0, ringWidth: 0.06 },
  },
  // NO glow
  glow: {
    unlinked: 0,
    linked: 0,
    hub: 0,
    cabal: 0,
  },
};

function getNodeRadius(node: SimNode): number {
  if (node.type === 'token') return VISUAL_CONFIG.radius.token;
  if (node.type === 'target') return VISUAL_CONFIG.radius.target;

  const category = node.visualCategory || 'linked';
  const baseRadius = VISUAL_CONFIG.radius[category] || VISUAL_CONFIG.radius.linked;

  if (category === 'hub' || category === 'cabal') {
    return baseRadius + (node.degreeCount || 0) * 0.5;
  }

  return baseRadius;
}

function getNodeColor(node: SimNode): string {
  // Special node types
  if (node.type === 'token') return NODE_COLORS.token;
  if (node.type === 'target') return NODE_COLORS.target;
  if (node.type === 'cabal-funder' || node.visualCategory === 'cabal') return NODE_COLORS['cabal-funder'];
  if (node.type === 'connected' || node.metadata?.suspicious) return NODE_COLORS.connected;

  // Visual categories
  if (node.visualCategory === 'hub') return NODE_COLORS.hub;
  if (node.visualCategory === 'unlinked' || !node.isLinked) return NODE_COLORS.unlinked;

  // Holders get a subtle blue-gray
  if (node.type === 'holder') return NODE_COLORS.holder;

  return node.color || NODE_COLORS[node.type as keyof typeof NODE_COLORS] || NODE_COLORS.default;
}

// Bubble-style node component with outline ring effect
function AnimatedNode({
  node,
  onClick,
  onHover,
}: {
  node: SimNode;
  onClick?: (node: GraphNode) => void;
  onHover?: (node: GraphNode | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);

  const radius = node.radius || getNodeRadius(node);
  const category = node.visualCategory || 'linked';

  const pulseConfig = VISUAL_CONFIG.pulse[category] || VISUAL_CONFIG.pulse.linked;

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const t = clock.getElapsedTime();
      const pulseScale = 1 + Math.sin(t * pulseConfig.speed) * pulseConfig.amplitude;
      const entranceScale = node.entranceScale !== undefined ? node.entranceScale : 1;
      const finalScale = (hovered ? pulseScale * 1.15 : pulseScale) * entranceScale;

      groupRef.current.scale.setScalar(finalScale);

      if (node.x !== undefined && node.y !== undefined && node.z !== undefined) {
        groupRef.current.position.set(node.x, node.y, node.z);
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

  const nodeColor = getNodeColor(node);
  const isCabal = category === 'cabal' || node.type === 'cabal-funder' || node.metadata?.suspicious;
  const isHub = category === 'hub';

  return (
    <group
      ref={groupRef}
      position={[node.x || 0, node.y || 0, node.z || 0]}
    >
      {/* Clean solid sphere */}
      <mesh
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial
          color={nodeColor}
          emissive={hovered ? nodeColor : '#000000'}
          emissiveIntensity={hovered ? 0.3 : 0}
          metalness={0.1}
          roughness={0.8}
        />
      </mesh>

      {/* Thin outline ring for definition */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius * 1.05, 0.15, 8, 32]} />
        <meshBasicMaterial
          color={nodeColor}
          transparent
          opacity={hovered ? 1 : 0.6}
        />
      </mesh>

      {/* Cabal nodes get a subtle red ring indicator */}
      {isCabal && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * 1.3, 0.2, 8, 32]} />
          <meshBasicMaterial color="#ff3366" transparent opacity={0.8} />
        </mesh>
      )}

      {/* Hub nodes get a subtle amber ring */}
      {isHub && !isCabal && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * 1.2, 0.15, 8, 32]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.7} />
        </mesh>
      )}
    </group>
  );
}

// Simple link component - uses state instead of refs for the line object
function SimpleLink({
  link,
  nodes,
}: {
  link: SimLink;
  nodes: SimNode[];
}) {
  const lineRef = useRef<THREE.Line>(null!);
  const [line, setLine] = useState<THREE.Line | null>(null);

  const sourceNode = useMemo(() => {
    const sourceId = typeof link.source === 'string' ? link.source : link.source?.id;
    return nodes.find(n => n.id === sourceId);
  }, [link.source, nodes]);

  const targetNode = useMemo(() => {
    const targetId = typeof link.target === 'string' ? link.target : link.target?.id;
    return nodes.find(n => n.id === targetId);
  }, [link.target, nodes]);

  const linkStyle = useMemo(() => {
    if (!sourceNode || !targetNode) {
      return { color: '#556677', opacity: 0.3 };
    }

    // Suspicious cabal links - bright coral red
    if (link.suspicious) {
      return { color: '#ff6b6b', opacity: 0.8 };
    }

    // Links to/from cabal nodes - red tinted
    if (sourceNode.visualCategory === 'cabal' || targetNode.visualCategory === 'cabal') {
      return { color: '#ff5555', opacity: 0.7 };
    }

    // Links to/from hub nodes - warm orange
    if (sourceNode.visualCategory === 'hub' || targetNode.visualCategory === 'hub') {
      return { color: '#ffaa44', opacity: 0.6 };
    }

    // Regular linked nodes - visible connection
    if (sourceNode.isLinked && targetNode.isLinked) {
      return { color: '#8899aa', opacity: 0.5 };
    }

    // Default
    return { color: '#667788', opacity: 0.4 };
  }, [sourceNode, targetNode, link.suspicious]);

  useEffect(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(6);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: linkStyle.color,
      transparent: true,
      opacity: linkStyle.opacity,
    });

    const newLine = new THREE.Line(geometry, material);
    lineRef.current = newLine;
    setLine(newLine);

    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [linkStyle.color, linkStyle.opacity]);

  useFrame(() => {
    if (!sourceNode || !targetNode || !lineRef.current) return;

    const geometry = lineRef.current.geometry;
    const positions = geometry.attributes.position.array as Float32Array;
    positions[0] = sourceNode.x || 0;
    positions[1] = sourceNode.y || 0;
    positions[2] = sourceNode.z || 0;
    positions[3] = targetNode.x || 0;
    positions[4] = targetNode.y || 0;
    positions[5] = targetNode.z || 0;
    geometry.attributes.position.needsUpdate = true;
  });

  if (!sourceNode || !targetNode || !line) return null;

  return <primitive object={line} />;
}

// Camera controller
function CameraController({
  targetPosition,
  enabled,
}: {
  targetPosition: THREE.Vector3 | null;
  enabled: boolean;
}) {
  const { camera } = useThree();
  const targetRef = useRef<THREE.Vector3 | null>(null);
  const startPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const progressRef = useRef(0);

  useEffect(() => {
    if (targetPosition && enabled) {
      targetRef.current = targetPosition.clone();
      startPosRef.current = camera.position.clone();
      progressRef.current = 0;
    }
  }, [targetPosition, enabled, camera]);

  useFrame((_, delta) => {
    if (!targetRef.current || progressRef.current >= 1) return;

    progressRef.current = Math.min(1, progressRef.current + delta * 2);
    const t = progressRef.current < 0.5
      ? 4 * progressRef.current * progressRef.current * progressRef.current
      : 1 - Math.pow(-2 * progressRef.current + 2, 3) / 2;

    const direction = targetRef.current.clone().normalize();
    if (direction.length() === 0) direction.set(0, 0, 1);
    const finalPos = targetRef.current.clone().add(direction.multiplyScalar(100));

    camera.position.lerpVectors(startPosRef.current, finalPos, t);
    camera.lookAt(targetRef.current);
  });

  return null;
}

// Main scene content - uses stable state pattern
function SceneContent({
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
  const [zoomTarget, setZoomTarget] = useState<THREE.Vector3 | null>(null);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const simulationRef = useRef<ReturnType<typeof forceSimulation> | null>(null);
  const tickCountRef = useRef(0);
  const baseDataIdRef = useRef<string>(''); // Track base scan ID
  const frameCountRef = useRef(0);
  const nodeMapRef = useRef<Map<string, SimNode>>(new Map()); // Preserve node positions

  // Base data ID - only changes on new scan, not incremental streaming updates
  const baseDataId = useMemo(() => {
    return data.nodes[0]?.id || '';
  }, [data.nodes]);

  // Initialize simulation only when data actually changes
  useEffect(() => {
    if (!data || data.nodes.length === 0) return;

    const isNewScan = baseDataId !== baseDataIdRef.current;
    baseDataIdRef.current = baseDataId;

    const existingPositions = nodeMapRef.current;
    const analyzedNodes = analyzeGraph(data.nodes, data.links);
    const componentMap = findLinkedComponents(data.nodes, data.links);

    const nodeCount = data.nodes.length;
    const spread = Math.max(200, Math.sqrt(nodeCount) * 25);

    // Create simNodes, preserving positions for existing nodes
    const simNodes: SimNode[] = analyzedNodes.map((n) => {
      const radius = getNodeRadius(n as SimNode);
      const existing = existingPositions.get(n.id);

      if (existing && !isNewScan) {
        // Preserve position for incremental updates
        return {
          ...n,
          x: existing.x,
          y: existing.y,
          z: existing.z,
          vx: existing.vx || 0,
          vy: existing.vy || 0,
          vz: existing.vz || 0,
          radius,
          entranceScale: 1,
        };
      }

      // New node - position near linked node or random
      let initialX = (Math.random() - 0.5) * spread;
      let initialY = (Math.random() - 0.5) * spread;
      let initialZ = (Math.random() - 0.5) * spread;

      if (!isNewScan) {
        const linkedLink = data.links.find(l => l.source === n.id || l.target === n.id);
        if (linkedLink) {
          const linkedId = linkedLink.source === n.id ? linkedLink.target : linkedLink.source;
          const linkedNode = existingPositions.get(linkedId as string);
          if (linkedNode && linkedNode.x !== undefined) {
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
        radius,
        entranceScale: 1,
      };
    });

    // Update node map
    const tempNodeMap = new Map<string, SimNode>();
    simNodes.forEach(n => tempNodeMap.set(n.id, n));
    nodeMapRef.current = tempNodeMap;

    // Stop existing simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const simLinks: SimLink[] = data.links.map((l) => ({
      source: l.source,
      target: l.target,
      value: l.value,
      suspicious: l.suspicious,
    }));

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
            // Cabal links should pull nodes closer together
            if (link.suspicious) return 35;
            const sourceNode = typeof link.source === 'string' ? tempNodeMap.get(link.source) : link.source;
            const targetNode = typeof link.target === 'string' ? tempNodeMap.get(link.target) : link.target;
            if (sourceNode && targetNode) {
              const sameComponent = areInSameComponent(sourceNode.id, targetNode.id, componentMap);
              return sameComponent ? 50 : 100;
            }
            return 70;
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .strength((link: any) => link.suspicious ? 0.8 : 0.5)
      )
      .force(
        'charge',
        forceManyBody()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .strength((d: any) => {
            // Gentler repulsion to keep nodes in compact sphere
            if (!d.isLinked) return -40;
            // Cabal nodes push away more to create distinct clusters
            if (d.visualCategory === 'cabal') return -300;
            if (d.visualCategory === 'hub') return -200;
            // Linked nodes (connected to cabal) moderate repulsion
            return -100;
          })
          .distanceMax(400)
      )
      .force('center', forceCenter(0, 0, 0).strength(0.02))
      .force(
        'collide',
        forceCollide()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .radius((d: any) => {
            // Collision radius to prevent overlap but allow closer packing
            if (!d.isLinked) return (d.radius || 3) * 2;
            return (d.radius || 3) * 1.8;
          })
          .strength(0.6)
      )
      .force(
        'radial',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (forceRadial as any)(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (d: any) => {
            // Spherical distribution scaled to node count
            const baseRadius = Math.sqrt(nodeCount) * 18;
            if (d.visualCategory === 'cabal') return baseRadius * 0.35;
            if (d.isLinked) return baseRadius * 0.55;
            return baseRadius * 0.75 + Math.random() * baseRadius * 0.25; // Outer shell for unlinked
          },
          0, 0, 0
        ).strength(0.06)
      )
      .alphaDecay(isNewScan ? 0.015 : 0.04) // Faster decay for incremental updates
      .velocityDecay(0.35);

    simulationRef.current = simulation;
    tickCountRef.current = isNewScan ? 0 : 200; // Skip animation for incremental
    frameCountRef.current = 0;

    // Warm up - less for incremental updates since positions are preserved
    const warmupTicks = isNewScan ? 150 : 30;
    for (let i = 0; i < warmupTicks; i++) {
      simulation.tick();
    }

    // Update node map with warmed-up positions
    simNodes.forEach(n => nodeMapRef.current.set(n.id, n));

    setNodes([...simNodes]);
    setLinks([...simLinks]);

    return () => {
      simulation.stop();
    };
  }, [baseDataId, data]);

  // Animation frame - only update state occasionally
  useFrame(() => {
    frameCountRef.current++;

    if (simulationRef.current && tickCountRef.current < 300) {
      simulationRef.current.tick();
      tickCountRef.current++;

      // Only trigger React re-render every 10 frames to avoid infinite loops
      if (frameCountRef.current % 10 === 0) {
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

  const nodeMap = useMemo(() => {
    const map = new Map<string, SimNode>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onNodeClick?.(node);

      const simNode = nodeMap.get(node.id);
      if (simNode && simNode.x !== undefined && simNode.y !== undefined && simNode.z !== undefined) {
        setZoomTarget(new THREE.Vector3(simNode.x, simNode.y, simNode.z));
        setZoomEnabled(true);
        setTimeout(() => setZoomEnabled(false), 1500);
      }
    },
    [nodeMap, onNodeClick]
  );

  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[200, 200, 200]} intensity={0.8} />
      <pointLight position={[-200, -200, -200]} intensity={0.4} color="#6688ff" />

      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        rotateSpeed={0.5}
        zoomSpeed={1.0}
        minDistance={30}
        maxDistance={2500}
      />

      <CameraController targetPosition={zoomTarget} enabled={zoomEnabled} />

      {links.map((link, i) => (
        <SimpleLink key={`link-${i}`} link={link} nodes={nodes} />
      ))}

      {nodes.map((node) => (
        <AnimatedNode
          key={node.id}
          node={node}
          onClick={handleNodeClick}
          onHover={onNodeHover}
        />
      ))}
    </>
  );
}

// Main Graph3D component
export function Graph3D({ data, onNodeClick, onNodeHover }: Graph3DProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[#e34946]">Loading visualization...</div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-[#5a5a6e]">No data to display</div>
      </div>
    );
  }

  // Calculate camera distance based on node count - start zoomed out to see everything
  const cameraZ = Math.max(500, Math.sqrt(data.nodes.length) * 60);

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
      <Canvas
        camera={{ position: [0, 0, cameraZ], fov: 75, near: 0.1, far: 5000 }}
        style={{ background: '#0a0a0a' }}
        gl={{ antialias: true, alpha: false }}
      >
        <SceneContent data={data} onNodeClick={onNodeClick} onNodeHover={onNodeHover} />
      </Canvas>
    </div>
  );
}

export default Graph3D;
