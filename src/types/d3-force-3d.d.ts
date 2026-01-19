declare module 'd3-force-3d' {
  export interface SimulationNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLink<N extends SimulationNode> {
    source: N | string | number;
    target: N | string | number;
    index?: number;
  }

  export interface Force<N extends SimulationNode, L extends SimulationLink<N>> {
    (alpha: number): void;
    initialize?(nodes: N[], random: () => number): void;
  }

  export interface ForceLink<N extends SimulationNode, L extends SimulationLink<N>> extends Force<N, L> {
    links(): L[];
    links(links: L[]): this;
    id(): (node: N, i: number, nodes: N[]) => string | number;
    id(id: (node: N, i: number, nodes: N[]) => string | number): this;
    distance(): number | ((link: L, i: number, links: L[]) => number);
    distance(distance: number | ((link: L, i: number, links: L[]) => number)): this;
    strength(): number | ((link: L, i: number, links: L[]) => number);
    strength(strength: number | ((link: L, i: number, links: L[]) => number)): this;
    iterations(): number;
    iterations(iterations: number): this;
  }

  export interface ForceManyBody<N extends SimulationNode> extends Force<N, never> {
    strength(): number | ((node: N, i: number, nodes: N[]) => number);
    strength(strength: number | ((node: N, i: number, nodes: N[]) => number)): this;
    theta(): number;
    theta(theta: number): this;
    distanceMin(): number;
    distanceMin(distance: number): this;
    distanceMax(): number;
    distanceMax(distance: number): this;
  }

  export interface ForceCenter<N extends SimulationNode> extends Force<N, never> {
    x(): number;
    x(x: number): this;
    y(): number;
    y(y: number): this;
    z(): number;
    z(z: number): this;
    strength(): number;
    strength(strength: number): this;
  }

  export interface Simulation<N extends SimulationNode, L extends SimulationLink<N>> {
    restart(): this;
    stop(): this;
    tick(iterations?: number): this;
    nodes(): N[];
    nodes(nodes: N[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(): number;
    alphaMin(min: number): this;
    alphaDecay(): number;
    alphaDecay(decay: number): this;
    alphaTarget(): number;
    alphaTarget(target: number): this;
    velocityDecay(): number;
    velocityDecay(decay: number): this;
    force(name: string): Force<N, L> | undefined;
    force(name: string, force: Force<N, L> | null): this;
    find(x: number, y: number, z?: number, radius?: number): N | undefined;
    randomSource(): () => number;
    randomSource(source: () => number): this;
    on(typenames: string): ((this: Simulation<N, L>) => void) | undefined;
    on(typenames: string, listener: ((this: Simulation<N, L>) => void) | null): this;
  }

  export function forceSimulation<N extends SimulationNode>(
    nodes?: N[],
    numDimensions?: number
  ): Simulation<N, SimulationLink<N>>;

  export function forceLink<N extends SimulationNode, L extends SimulationLink<N>>(
    links?: L[]
  ): ForceLink<N, L>;

  export function forceManyBody<N extends SimulationNode>(): ForceManyBody<N>;

  export function forceCenter<N extends SimulationNode>(
    x?: number,
    y?: number,
    z?: number
  ): ForceCenter<N>;

  export interface ForceCollide<N extends SimulationNode> extends Force<N, never> {
    radius(): number | ((node: N, i: number, nodes: N[]) => number);
    radius(radius: number | ((node: N, i: number, nodes: N[]) => number)): this;
    strength(): number;
    strength(strength: number): this;
    iterations(): number;
    iterations(iterations: number): this;
  }

  export function forceCollide<N extends SimulationNode>(
    radius?: number | ((node: N, i: number, nodes: N[]) => number)
  ): ForceCollide<N>;

  export function forceRadial<N extends SimulationNode>(
    radius?: number | ((node: N, i: number, nodes: N[]) => number),
    x?: number,
    y?: number,
    z?: number
  ): Force<N, never>;

  export function forceX<N extends SimulationNode>(
    x?: number | ((node: N, i: number, nodes: N[]) => number)
  ): Force<N, never>;

  export function forceY<N extends SimulationNode>(
    y?: number | ((node: N, i: number, nodes: N[]) => number)
  ): Force<N, never>;

  export function forceZ<N extends SimulationNode>(
    z?: number | ((node: N, i: number, nodes: N[]) => number)
  ): Force<N, never>;
}
