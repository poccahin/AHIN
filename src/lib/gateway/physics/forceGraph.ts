/**
 * Lightweight 3D force-directed graph solver.
 *
 * Why not `d3-force` directly? d3-force is excellent but 2D-only by default
 * and assumes Object mutation in a way that's awkward inside `useFrame`.
 * We implement a focused 3D variant with the specific force laws needed
 * for AHIN — and we get exact control over integration timestep, damping,
 * and the type-specific rules (Genesis attraction, Sentinel repulsion,
 * Eco flocking, etc.).
 *
 * Integration model: semi-implicit Euler with velocity damping. Runs at
 * variable dt (passed in from useFrame), clamped to avoid blow-ups on
 * tab-switch / long frames.
 *
 * All operations are in-place on AhinNode position/velocity arrays for zero
 * allocation per frame. This is the hot path — every cycle matters.
 */

import type { AhinNode, AhinLink, NodeType } from '@/src/types/gateway';
import { NODE_TYPES, WORLD_RADIUS } from '@/src/lib/gateway/constants/nodeTypes';
import { applyTypeForces } from './nodeForces';

/** Tunable parameters for the global force field. */
export interface SolverParams {
  /** Strength of the global N-body repulsion/attraction (Coulomb-style). */
  chargeStrength: number;
  /** Strength of attraction between linked nodes (spring). */
  linkStrength: number;
  /** Ideal rest length of a link in world units. */
  linkRestLength: number;
  /** Strength of pull toward the world origin. Keeps the swarm centered. */
  centeringStrength: number;
  /** Velocity damping per second (0..1). Higher = more viscous. */
  damping: number;
  /** Max speed clamp — prevents runaway nodes. */
  maxSpeed: number;
  /**
   * Entropy multiplier: 0 = full topology (present), 1 = full chaos (past).
   * Multiplies all structured forces by (1 - entropy) and adds a Brownian
   * noise term scaled by entropy. Driven by the Timeline HUD.
   */
  entropy: number;
  /** Hard radius — nodes outside are pulled back forcefully. */
  worldRadius: number;
}

export const DEFAULT_PARAMS: SolverParams = {
  chargeStrength: 1.6,
  linkStrength: 0.35,
  linkRestLength: 4.5,
  centeringStrength: 0.02,
  damping: 0.92,           // per-frame factor; ≈8% velocity bleed per frame
  maxSpeed: 14,
  entropy: 0,
  worldRadius: WORLD_RADIUS,
};

/** Clamp dt to avoid integration explosions after a tab-switch. */
const MAX_DT = 1 / 30;
/** Minimum separation distance used to avoid singularities in the repulsion law. */
const MIN_SEP = 0.5;

/**
 * One simulation step.
 *
 * @param nodes  Live node array (positions/velocities mutated in place).
 * @param links  Active link array.
 * @param dt     Frame delta time in seconds.
 * @param params Tunables.
 * @param pulse  Optional radial impulse origin + strength (decayed by caller).
 *               Used by Genesis Ignition to give the network a synchronized
 *               outward "breath" when the milestone fires.
 */
export function stepForceGraph(
  nodes: AhinNode[],
  links: AhinLink[],
  dt: number,
  params: SolverParams = DEFAULT_PARAMS,
  pulse: { origin: [number, number, number]; strength: number } | null = null,
): void {
  // Skip if no nodes or paused.
  if (nodes.length === 0 || dt <= 0) return;

  const stepDt = Math.min(dt, MAX_DT);
  const entropyFactor = 1 - params.entropy; // 1 = ordered, 0 = chaos

  // Build an index for O(1) node lookup by id (used by link forces).
  const nodeById = new Map<string, AhinNode>();
  for (const n of nodes) nodeById.set(n.id, n);

  // ---- 1. Reset force accumulators (we'll use velocity arrays as accumulators
  //         indirectly by applying impulses and integrating at the end).
  //         Instead we use a parallel "force" scratch array.
  // ---- For zero-allocation we keep a module-level scratch buffer keyed by length.
  const forces = getScratchForces(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    forces[i][0] = 0;
    forces[i][1] = 0;
    forces[i][2] = 0;
  }

  // ---- 2. N-body charge (Coulomb-style repulsion/attraction).
  // Only consider healthy nodes for the topology — slashed nodes are detached.
  const activeIdxs: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].health === 'healthy') activeIdxs.push(i);
  }

  for (let a = 0; a < activeIdxs.length; a++) {
    const ia = activeIdxs[a];
    const na = nodes[ia];
    const cfgA = NODE_TYPES[na.type];

    for (let b = a + 1; b < activeIdxs.length; b++) {
      const ib = activeIdxs[b];
      const nb = nodes[ib];
      const cfgB = NODE_TYPES[nb.type];

      const dx = nb.position[0] - na.position[0];
      const dy = nb.position[1] - na.position[1];
      const dz = nb.position[2] - na.position[2];
      const distSq = Math.max(dx * dx + dy * dy + dz * dz, MIN_SEP * MIN_SEP);
      const dist = Math.sqrt(distSq);

      // Combined charge: average of the two endpoints' charges, scaled by
      // global chargeStrength.
      //   - charge < 0 → repulsion
      //   - charge > 0 → attraction
      // Force magnitude ~ chargeProduct / distSq, capped to prevent blow-up.
      const chargeProduct =
        (cfgA.forces.charge + cfgB.forces.charge) * 0.5 * params.chargeStrength;

      // Genesis exerts strong universal attraction → use its raw charge if either
      // endpoint is Genesis (don't average it away).
      const isGenesisPair = na.type === 'genesis' || nb.type === 'genesis';
      const effectiveCharge = isGenesisPair
        ? Math.max(cfgA.forces.charge, cfgB.forces.charge) * params.chargeStrength
        : chargeProduct;

      // Sign convention: positive force = pull together (toward each other).
      const forceMag = (effectiveCharge / distSq) * entropyFactor;

      const ux = dx / dist;
      const uy = dy / dist;
      const uz = dz / dist;

      // Apply equal and opposite forces.
      forces[ia][0] += ux * forceMag;
      forces[ia][1] += uy * forceMag;
      forces[ia][2] += uz * forceMag;
      forces[ib][0] -= ux * forceMag;
      forces[ib][1] -= uy * forceMag;
      forces[ib][2] -= uz * forceMag;
    }
  }

  // ---- 3. Link springs (Hookean attraction along edges).
  for (const link of links) {
    const sa = nodeById.get(link.sourceId);
    const sb = nodeById.get(link.targetId);
    if (!sa || !sb) continue;
    if (sa.health !== 'healthy' || sb.health !== 'healthy') continue;

    const ia = nodes.indexOf(sa);
    const ib = nodes.indexOf(sb);
    if (ia < 0 || ib < 0) continue;

    const dx = sb.position[0] - sa.position[0];
    const dy = sb.position[1] - sa.position[1];
    const dz = sb.position[2] - sa.position[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;

    // Use the shorter of the two endpoints' linkDistanceMul (the "stickier"
    // node wins — e.g. settlement nodes pull tight).
    const cfgA = NODE_TYPES[sa.type];
    const cfgB = NODE_TYPES[sb.type];
    const restLen =
      params.linkRestLength *
      Math.min(cfgA.forces.linkDistanceMul, cfgB.forces.linkDistanceMul);

    const stretch = dist - restLen;
    const forceMag = stretch * params.linkStrength * entropyFactor;

    const ux = dx / dist;
    const uy = dy / dist;
    const uz = dz / dist;

    forces[ia][0] += ux * forceMag;
    forces[ia][1] += uy * forceMag;
    forces[ia][2] += uz * forceMag;
    forces[ib][0] -= ux * forceMag;
    forces[ib][1] -= uy * forceMag;
    forces[ib][2] -= uz * forceMag;
  }

  // ---- 4. Centering force — pulls everything toward the origin.
  for (const i of activeIdxs) {
    const n = nodes[i];
    forces[i][0] -= n.position[0] * params.centeringStrength;
    forces[i][1] -= n.position[1] * params.centeringStrength;
    forces[i][2] -= n.position[2] * params.centeringStrength;
  }

  // ---- 5. Type-specific behaviors (eco flocking, sentinel scanning,
  //         routing darting, settlement binary orbits). Delegated to
  //         nodeForces.ts to keep this file focused on the integrator.
  applyTypeForces(nodes, links, forces, params);

  // ---- 6. Entropy noise — Brownian motion when the timeline is in the past.
  if (params.entropy > 0) {
    const noiseMag = params.entropy * 6;
    for (const i of activeIdxs) {
      forces[i][0] += (Math.random() * 2 - 1) * noiseMag;
      forces[i][1] += (Math.random() * 2 - 1) * noiseMag;
      forces[i][2] += (Math.random() * 2 - 1) * noiseMag;
    }
  }

  // ---- 7. Hard world boundary. Springy pushback past worldRadius.
  for (const i of activeIdxs) {
    const n = nodes[i];
    const r = Math.sqrt(
      n.position[0] * n.position[0] +
        n.position[1] * n.position[1] +
        n.position[2] * n.position[2],
    );
    if (r > params.worldRadius) {
      const over = r - params.worldRadius;
      const pull = over * 0.5;
      forces[i][0] -= (n.position[0] / r) * pull;
      forces[i][1] -= (n.position[1] / r) * pull;
      forces[i][2] -= (n.position[2] / r) * pull;
    }
  }

  // ---- 7b. Transient outward pulse (Genesis Ignition).
  // Applies a radial-outward force from `pulse.origin`. Falloff with
  // distance keeps near-field punch strong without flinging far nodes.
  if (pulse && pulse.strength > 0) {
    const px = pulse.origin[0];
    const py = pulse.origin[1];
    const pz = pulse.origin[2];
    for (const i of activeIdxs) {
      const n = nodes[i];
      const dx = n.position[0] - px;
      const dy = n.position[1] - py;
      const dz = n.position[2] - pz;
      const distSq = Math.max(dx * dx + dy * dy + dz * dz, 0.5);
      const dist = Math.sqrt(distSq);
      // Force ~ strength / dist (linear falloff). Strong but bounded.
      const mag = pulse.strength / dist;
      forces[i][0] += (dx / dist) * mag;
      forces[i][1] += (dy / dist) * mag;
      forces[i][2] += (dz / dist) * mag;
    }
  }

  // ---- 8. Integrate: semi-implicit Euler.
  // a = F / m, v += a * dt, p += v * dt, then damp.
  for (const i of activeIdxs) {
    const n = nodes[i];
    const invMass = 1 / n.mass;

    n.velocity[0] += forces[i][0] * invMass * stepDt;
    n.velocity[1] += forces[i][1] * invMass * stepDt;
    n.velocity[2] += forces[i][2] * invMass * stepDt;

    // Speed clamp.
    const speedSq =
      n.velocity[0] * n.velocity[0] +
      n.velocity[1] * n.velocity[1] +
      n.velocity[2] * n.velocity[2];
    if (speedSq > params.maxSpeed * params.maxSpeed) {
      const k = params.maxSpeed / Math.sqrt(speedSq);
      n.velocity[0] *= k;
      n.velocity[1] *= k;
      n.velocity[2] *= k;
    }

    n.position[0] += n.velocity[0] * stepDt;
    n.position[1] += n.velocity[1] * stepDt;
    n.position[2] += n.velocity[2] * stepDt;

    // Damping (frame-rate independent via exponential decay).
    const dampFactor = Math.pow(params.damping, stepDt * 60);
    n.velocity[0] *= dampFactor;
    n.velocity[1] *= dampFactor;
    n.velocity[2] *= dampFactor;
  }
}

// --- module-level scratch buffer for force accumulators (avoids GC churn) ---
let _scratchForces: [number, number, number][] = [];
function getScratchForces(n: number): [number, number, number][] {
  if (_scratchForces.length < n) {
    _scratchForces = Array.from({ length: n }, () => [0, 0, 0]);
  }
  return _scratchForces;
}

/**
 * Helper: try to form a new transient link between two nodes if their
 * configuration permits it. Used by higher-level interaction triggers
 * (Routing nodes spontaneously linking to nearby peers, etc.).
 *
 * Returns the link descriptor or null if rejected.
 */
export function tryFormLink(
  source: AhinNode,
  target: AhinNode,
  existingLinks: AhinLink[],
  maxLinks: number,
): { ok: boolean; reason?: string } {
  if (source.id === target.id) return { ok: false, reason: 'self-loop' };
  if (existingLinks.length >= maxLinks) return { ok: false, reason: 'at-capacity' };
  const key = [source.id, target.id].sort().join('|');
  const dup = existingLinks.some(
    (l) => [l.sourceId, l.targetId].sort().join('|') === key,
  );
  if (dup) return { ok: false, reason: 'duplicate' };
  return { ok: true };
}

/**
 * Find the nearest neighbor of a node within a max radius.
 * Used for routing-darting and sentinel-scanning behaviors.
 */
export function findNearestNeighbor(
  node: AhinNode,
  nodes: AhinNode[],
  maxRadius: number,
  predicate?: (candidate: AhinNode) => boolean,
): AhinNode | null {
  let best: AhinNode | null = null;
  let bestDistSq = maxRadius * maxRadius;
  for (const other of nodes) {
    if (other.id === node.id) continue;
    if (other.health !== 'healthy') continue;
    if (predicate && !predicate(other)) continue;
    const dx = other.position[0] - node.position[0];
    const dy = other.position[1] - node.position[1];
    const dz = other.position[2] - node.position[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = other;
    }
  }
  return best;
}

/** Pure type guard — true if `node` participates in the topology this frame. */
export function isActive(node: AhinNode): boolean {
  return node.health === 'healthy';
}
