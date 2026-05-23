/**
 * Zustand store: the single source of truth for the live AHIN topology.
 *
 * IMPORTANT: nodes' `position` and `velocity` arrays are mutated in place
 * by the force solver on every animation frame for performance. We do NOT
 * trigger a Zustand re-render on every tick — components read live data
 * via refs and `useFrame`. Zustand is used here for:
 *   - Structural changes (add/remove node, add/remove link)
 *   - Top-level state (timeline scrub position, active milestone)
 *   - Slashing flags
 *
 * Subscribing to fast-changing fields would cause React to re-render
 * 60 times per second, which we explicitly want to avoid.
 */

import { create } from 'zustand';
import type { AhinNode, AhinLink, NodeType, MilestoneId } from '@/types/network';
import { NODE_TYPES, NODE_TYPE_LIST, WORLD_RADIUS } from '@/lib/constants/nodeTypes';

interface NetworkState {
  /** Live node list. Position/velocity inside each node is mutated in place. */
  nodes: AhinNode[];
  /** Live link list. */
  links: AhinLink[];
  /**
   * Timeline scrub position. 0 = past (high entropy, drifting), 1 = present
   * (stable self-organizing network). Set by the bottom HUD slider.
   */
  timelineT: number;
  /** Currently-active milestone preset, if any. */
  activeMilestone: MilestoneId | null;
  /**
   * Transient outward kick read by the force solver each frame. Origin is
   * a world-space point; strength is the radial force magnitude;
   * `remaining` is the lifetime in seconds (decremented per frame in the
   * VoxelInstancedField useFrame). Used by Genesis Ignition.
   *
   * This is the only fast-changing field on the store. The solver reads
   * it via `getState()` (not subscription), so writes don't trigger
   * re-render storms. The final write to null at expiry IS one re-render,
   * which is fine — once per pulse.
   */
  pulse: { origin: [number, number, number]; strength: number; remaining: number } | null;

  // ---- actions ----
  setTimelineT: (t: number) => void;
  setActiveMilestone: (m: MilestoneId | null) => void;
  initializeNodes: () => void;
  addLink: (link: AhinLink) => void;
  removeLink: (id: string) => void;
  /** Update a node's health state. Called by the slashStore as it advances phases. */
  setNodeHealth: (id: string, health: AhinNode['health']) => void;
  /** Mark a link as errored (turns red, vibrates). Idempotent. */
  setLinkErrored: (id: string, errored: boolean) => void;
  /** Remove a node entirely (called at end of banishment phase). */
  removeNode: (id: string) => void;
  /** Reset everything to defaults (used by Genesis Ignition milestone). */
  reset: () => void;
  /** Set or clear the transient pulse. */
  setPulse: (pulse: NetworkState['pulse']) => void;
  /**
   * Spawn N additional eco nodes at the edge of the world sphere. They'll
   * be pulled inward by the force graph and integrate into the topology.
   * Used by the Macro Evolution milestone.
   */
  spawnEcoCluster: (count: number) => void;
}

let nodeIdCounter = 0;
function nextNodeId(type: NodeType): string {
  return `${type}-${++nodeIdCounter}`;
}

let linkIdCounter = 0;
export function nextLinkId(): string {
  return `link-${++linkIdCounter}`;
}

/**
 * Generate an evenly-distributed random point inside a sphere of given radius.
 * Uses cube-rejection for uniform volume distribution.
 */
function randomInSphere(radius: number): [number, number, number] {
  while (true) {
    const x = (Math.random() * 2 - 1) * radius;
    const y = (Math.random() * 2 - 1) * radius;
    const z = (Math.random() * 2 - 1) * radius;
    if (x * x + y * y + z * z <= radius * radius) {
      return [x, y, z];
    }
  }
}

/** Create the initial node population from NODE_TYPES.defaultCount. */
function createInitialNodes(): AhinNode[] {
  const nodes: AhinNode[] = [];
  for (const type of NODE_TYPE_LIST) {
    const cfg = NODE_TYPES[type];
    for (let i = 0; i < cfg.defaultCount; i++) {
      // Genesis sits at the origin (it's the central attractor).
      const position: [number, number, number] =
        type === 'genesis' ? [0, 0, 0] : randomInSphere(WORLD_RADIUS * 0.7);
      nodes.push({
        id: nextNodeId(type),
        type,
        health: 'healthy',
        position,
        velocity: [0, 0, 0],
        mass: cfg.mass,
        scale: type === 'genesis' ? 1.5 : 1.0,
        seed: Math.random(),
      });
    }
  }
  return nodes;
}

/**
 * Create the initial link population. Topology:
 *   - Genesis is connected to every Sentinel (governance backbone)
 *   - Each Settlement binds to its nearest Routing (binary orbit pairs)
 *   - Each Routing has 1-2 random peers (sparse compute mesh)
 *   - Each Eco connects to its nearest Sentinel (ecosystem-rule link)
 *
 * Total link count: roughly 25-35 for the default population.
 */
function createInitialLinks(nodes: AhinNode[]): AhinLink[] {
  const links: AhinLink[] = [];
  const seen = new Set<string>();

  const tryAdd = (a: string, b: string) => {
    if (a === b) return;
    const key = [a, b].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      id: nextLinkId(),
      sourceId: a,
      targetId: b,
      intensity: 0.6 + Math.random() * 0.4,
      pulsePhase: Math.random(),
      errored: false,
    });
  };

  const dist2 = (n1: AhinNode, n2: AhinNode) => {
    const dx = n2.position[0] - n1.position[0];
    const dy = n2.position[1] - n1.position[1];
    const dz = n2.position[2] - n1.position[2];
    return dx * dx + dy * dy + dz * dz;
  };

  const nearest = (
    src: AhinNode,
    pool: AhinNode[],
    predicate?: (n: AhinNode) => boolean,
  ): AhinNode | null => {
    let best: AhinNode | null = null;
    let bestD = Infinity;
    for (const cand of pool) {
      if (cand.id === src.id) continue;
      if (predicate && !predicate(cand)) continue;
      const d = dist2(src, cand);
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
    return best;
  };

  const genesis = nodes.find((n) => n.type === 'genesis');
  const sentinels = nodes.filter((n) => n.type === 'sentinel');
  const routings = nodes.filter((n) => n.type === 'routing');
  const settlements = nodes.filter((n) => n.type === 'settlement');
  const ecos = nodes.filter((n) => n.type === 'eco');

  // Genesis → every Sentinel.
  if (genesis) {
    for (const s of sentinels) tryAdd(genesis.id, s.id);
  }

  // Each Settlement → nearest Routing.
  for (const settle of settlements) {
    const partner = nearest(settle, routings);
    if (partner) tryAdd(settle.id, partner.id);
  }

  // Each Routing → 1-2 random routing peers.
  for (const r of routings) {
    const others = routings.filter((o) => o.id !== r.id);
    const k = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < k && others.length > 0; i++) {
      const pick = others.splice(
        Math.floor(Math.random() * others.length),
        1,
      )[0];
      tryAdd(r.id, pick.id);
    }
  }

  // Each Eco → nearest Sentinel.
  for (const eco of ecos) {
    const overseer = nearest(eco, sentinels);
    if (overseer) tryAdd(eco.id, overseer.id);
  }

  return links;
}

export const useNetworkStore = create<NetworkState>((set) => {
  const initialNodes = createInitialNodes();
  const initialLinks = createInitialLinks(initialNodes);
  return {
    nodes: initialNodes,
    links: initialLinks,
    timelineT: 1,
    activeMilestone: null,
    pulse: null,

    setTimelineT: (t) => set({ timelineT: Math.max(0, Math.min(1, t)) }),

    setActiveMilestone: (m) => set({ activeMilestone: m }),

    initializeNodes: () => {
      const nodes = createInitialNodes();
      const links = createInitialLinks(nodes);
      set({ nodes, links });
    },

    addLink: (link) =>
      set((s) => {
        // Dedupe by sorted endpoint pair.
        const key = [link.sourceId, link.targetId].sort().join('|');
        const exists = s.links.some(
          (l) => [l.sourceId, l.targetId].sort().join('|') === key,
        );
        if (exists) return s;
        return { links: [...s.links, link] };
      }),

    removeLink: (id) =>
      set((s) => ({ links: s.links.filter((l) => l.id !== id) })),

    setNodeHealth: (id, health) =>
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? { ...n, health } : n)),
      })),

    setLinkErrored: (id, errored) =>
      set((s) => ({
        links: s.links.map((l) => (l.id === id ? { ...l, errored } : l)),
      })),

    removeNode: (id) =>
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        // Also drop any links touching this node.
        links: s.links.filter(
          (l) => l.sourceId !== id && l.targetId !== id,
        ),
      })),

    reset: () => {
      const nodes = createInitialNodes();
      const links = createInitialLinks(nodes);
      set({
        nodes,
        links,
        timelineT: 1,
        activeMilestone: null,
        pulse: null,
      });
    },

    setPulse: (pulse) => set({ pulse }),

    spawnEcoCluster: (count) =>
      set((s) => {
        // Spawn fresh eco nodes on a random patch of the world-sphere surface.
        // They'll be pulled inward by the centering + Genesis attraction
        // forces and integrate into the topology over a few seconds.
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(2 * Math.random() - 1);
        const baseDir: [number, number, number] = [
          Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi),
        ];
        const radius = WORLD_RADIUS * 0.95;
        const cfg = NODE_TYPES['eco'];
        const newNodes: AhinNode[] = [];
        for (let i = 0; i < count; i++) {
          // Cluster the new nodes near baseDir with small jitter.
          const jitter: [number, number, number] = [
            (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.4,
            (Math.random() - 0.5) * 0.4,
          ];
          const dir: [number, number, number] = [
            baseDir[0] + jitter[0],
            baseDir[1] + jitter[1],
            baseDir[2] + jitter[2],
          ];
          const len = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2) || 1;
          newNodes.push({
            id: nextNodeId('eco'),
            type: 'eco',
            health: 'healthy',
            position: [
              (dir[0] / len) * radius,
              (dir[1] / len) * radius,
              (dir[2] / len) * radius,
            ],
            // Mild inward velocity for an "arriving" feel.
            velocity: [(-dir[0] / len) * 2.5, (-dir[1] / len) * 2.5, (-dir[2] / len) * 2.5],
            mass: cfg.mass,
            scale: 1.0,
            seed: Math.random(),
          });
        }
        return { nodes: [...s.nodes, ...newNodes] };
      }),
  };
});
