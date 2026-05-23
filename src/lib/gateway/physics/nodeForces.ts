/**
 * Per-type force behaviors that operate on top of the global N-body solver.
 *
 * Each behavior reads from the node array and accumulates into the same
 * `forces` scratch buffer used by `forceGraph.ts`. They run after the global
 * charge and link forces but before noise and boundary correction, so they
 * can sculpt the topology's character without fighting the base physics.
 *
 * Behaviors implemented:
 *   - Eco flocking (boids: cohesion + alignment + separation among eco nodes)
 *   - Sentinel scanning (push conflicting neighbors away)
 *   - Routing darting (random impulse to chase nearby targets)
 *   - Settlement binary orbits (strong pull toward nearest non-settlement node)
 *   - Genesis godsignal (radial pulse breathing, in addition to base attraction)
 */

import type { AhinNode, AhinLink } from '@/src/types/gateway';
import type { SolverParams } from './forceGraph';
import { NODE_TYPES } from '@/src/lib/gateway/constants/nodeTypes';

type ForceBuf = [number, number, number][];

/** Tunables — coefficients for each per-type behavior. */
const ECO_PERCEPTION_RADIUS = 6;
const ECO_SEPARATION_RADIUS = 2;
const ECO_COHESION_STRENGTH = 0.6;
const ECO_ALIGNMENT_STRENGTH = 0.4;
const ECO_SEPARATION_STRENGTH = 2.4;

const SENTINEL_SCAN_RADIUS = 7;
const SENTINEL_PUSH_STRENGTH = 1.2;

const ROUTING_DART_RADIUS = 8;
const ROUTING_DART_STRENGTH = 1.8;
/** Probability per second a Routing node picks a new dart target. */
const ROUTING_RETARGET_RATE = 1.5;

const SETTLEMENT_ORBIT_STRENGTH = 1.4;

const GENESIS_PULSE_AMP = 0.6;
const GENESIS_PULSE_FREQ = 0.4;

// Per-routing-node dart target memory. Keyed by routing node id → target node id.
// Lives at module scope: cheap and survives across frames.
const dartTargets = new Map<string, string>();

/** Time accumulator (seconds), advanced externally. Used for Genesis pulse. */
let _t = 0;

export function applyTypeForces(
  nodes: AhinNode[],
  _links: AhinLink[],
  forces: ForceBuf,
  params: SolverParams,
): void {
  const entropyFactor = 1 - params.entropy;

  // Advance internal clock — caller doesn't pass dt directly because we drive
  // this from the solver step; we approximate with a fixed tick. Genesis
  // pulse only needs a smooth time source.
  _t += 1 / 60;

  // Build per-type index for fast lookups.
  const ecoIdxs: number[] = [];
  const sentinelIdxs: number[] = [];
  const routingIdxs: number[] = [];
  const settlementIdxs: number[] = [];
  const genesisIdxs: number[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.health !== 'healthy') continue;
    switch (n.type) {
      case 'eco':        ecoIdxs.push(i); break;
      case 'sentinel':   sentinelIdxs.push(i); break;
      case 'routing':    routingIdxs.push(i); break;
      case 'settlement': settlementIdxs.push(i); break;
      case 'genesis':    genesisIdxs.push(i); break;
    }
  }

  // ===== ECO FLOCKING (Reynolds boids: cohesion / alignment / separation) =====
  // Eco nodes cluster into breathing ecosystems. Classic boids applied only
  // among eco-eco pairs.
  if (ecoIdxs.length > 1) {
    for (const i of ecoIdxs) {
      const me = nodes[i];

      let cohX = 0, cohY = 0, cohZ = 0;
      let alignX = 0, alignY = 0, alignZ = 0;
      let sepX = 0, sepY = 0, sepZ = 0;
      let cohCount = 0;
      let sepCount = 0;

      for (const j of ecoIdxs) {
        if (j === i) continue;
        const other = nodes[j];
        const dx = other.position[0] - me.position[0];
        const dy = other.position[1] - me.position[1];
        const dz = other.position[2] - me.position[2];
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < ECO_PERCEPTION_RADIUS * ECO_PERCEPTION_RADIUS) {
          cohX += other.position[0];
          cohY += other.position[1];
          cohZ += other.position[2];
          alignX += other.velocity[0];
          alignY += other.velocity[1];
          alignZ += other.velocity[2];
          cohCount++;

          if (distSq < ECO_SEPARATION_RADIUS * ECO_SEPARATION_RADIUS && distSq > 1e-4) {
            const dist = Math.sqrt(distSq);
            // Separation falls off with inverse distance.
            const k = (ECO_SEPARATION_RADIUS - dist) / dist;
            sepX -= dx * k;
            sepY -= dy * k;
            sepZ -= dz * k;
            sepCount++;
          }
        }
      }

      if (cohCount > 0) {
        // Cohesion: steer toward average neighbor position.
        cohX = cohX / cohCount - me.position[0];
        cohY = cohY / cohCount - me.position[1];
        cohZ = cohZ / cohCount - me.position[2];
        forces[i][0] += cohX * ECO_COHESION_STRENGTH * entropyFactor;
        forces[i][1] += cohY * ECO_COHESION_STRENGTH * entropyFactor;
        forces[i][2] += cohZ * ECO_COHESION_STRENGTH * entropyFactor;

        // Alignment: steer toward average neighbor heading.
        alignX = alignX / cohCount - me.velocity[0];
        alignY = alignY / cohCount - me.velocity[1];
        alignZ = alignZ / cohCount - me.velocity[2];
        forces[i][0] += alignX * ECO_ALIGNMENT_STRENGTH * entropyFactor;
        forces[i][1] += alignY * ECO_ALIGNMENT_STRENGTH * entropyFactor;
        forces[i][2] += alignZ * ECO_ALIGNMENT_STRENGTH * entropyFactor;
      }

      if (sepCount > 0) {
        // Separation: avoid crowding.
        forces[i][0] += sepX * ECO_SEPARATION_STRENGTH;
        forces[i][1] += sepY * ECO_SEPARATION_STRENGTH;
        forces[i][2] += sepZ * ECO_SEPARATION_STRENGTH;
      }
    }
  }

  // ===== SENTINEL SCANNING =====
  // Sentinels exert extra short-range repulsion on non-sentinel nodes within
  // their scan radius. Visually: nodes "back away" from a sentinel that's
  // looking at them.
  for (const i of sentinelIdxs) {
    const sentinel = nodes[i];
    for (let j = 0; j < nodes.length; j++) {
      if (j === i) continue;
      const other = nodes[j];
      if (other.health !== 'healthy') continue;
      if (other.type === 'sentinel') continue;

      const dx = other.position[0] - sentinel.position[0];
      const dy = other.position[1] - sentinel.position[1];
      const dz = other.position[2] - sentinel.position[2];
      const distSq = dx * dx + dy * dy + dz * dz;
      const scanSq = SENTINEL_SCAN_RADIUS * SENTINEL_SCAN_RADIUS;
      if (distSq >= scanSq || distSq < 1e-4) continue;

      const dist = Math.sqrt(distSq);
      // Falloff: full strength at center, zero at scan radius.
      const k = (1 - dist / SENTINEL_SCAN_RADIUS) * SENTINEL_PUSH_STRENGTH * entropyFactor;
      const ux = dx / dist;
      const uy = dy / dist;
      const uz = dz / dist;
      forces[j][0] += ux * k;
      forces[j][1] += uy * k;
      forces[j][2] += uz * k;
      // Newton's third law (sentinel gets a tiny kick back, but its mass
      // dampens this — that's why it "moves slowly").
      forces[i][0] -= ux * k * 0.3;
      forces[i][1] -= uy * k * 0.3;
      forces[i][2] -= uz * k * 0.3;
    }
  }

  // ===== ROUTING DARTING =====
  // Each Routing node picks a nearby target and accelerates toward it.
  // Targets are rotated stochastically — this gives the "darting" look.
  for (const i of routingIdxs) {
    const me = nodes[i];

    // Maybe retarget.
    const shouldRetarget =
      !dartTargets.has(me.id) ||
      Math.random() < ROUTING_RETARGET_RATE / 60;

    if (shouldRetarget) {
      // Pick a random nearby node within ROUTING_DART_RADIUS.
      const candidates: AhinNode[] = [];
      for (const other of nodes) {
        if (other.id === me.id) continue;
        if (other.health !== 'healthy') continue;
        const dx = other.position[0] - me.position[0];
        const dy = other.position[1] - me.position[1];
        const dz = other.position[2] - me.position[2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < ROUTING_DART_RADIUS * ROUTING_DART_RADIUS) {
          candidates.push(other);
        }
      }
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        dartTargets.set(me.id, pick.id);
      } else {
        dartTargets.delete(me.id);
      }
    }

    // Apply dart force toward current target.
    const targetId = dartTargets.get(me.id);
    if (targetId) {
      const target = nodes.find((n) => n.id === targetId && n.health === 'healthy');
      if (target) {
        const dx = target.position[0] - me.position[0];
        const dy = target.position[1] - me.position[1];
        const dz = target.position[2] - me.position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
        // Don't dart right on top of the target — pull toward a small offset.
        const desired = 1.5;
        const stretch = dist - desired;
        const k = (stretch * ROUTING_DART_STRENGTH * entropyFactor) / dist;
        forces[i][0] += dx * k;
        forces[i][1] += dy * k;
        forces[i][2] += dz * k;
      } else {
        dartTargets.delete(me.id);
      }
    }
  }

  // ===== SETTLEMENT BINARY ORBITS =====
  // Each Settlement node binds tightly to its single nearest non-settlement
  // neighbor, forming a "binary orbit." Strong inward pull at slightly above
  // contact distance.
  for (const i of settlementIdxs) {
    const me = nodes[i];
    let best: AhinNode | null = null;
    let bestDistSq = Infinity;
    for (const other of nodes) {
      if (other.id === me.id) continue;
      if (other.health !== 'healthy') continue;
      if (other.type === 'settlement') continue;
      const dx = other.position[0] - me.position[0];
      const dy = other.position[1] - me.position[1];
      const dz = other.position[2] - me.position[2];
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = other;
      }
    }
    if (best) {
      const dx = best.position[0] - me.position[0];
      const dy = best.position[1] - me.position[1];
      const dz = best.position[2] - me.position[2];
      const dist = Math.sqrt(bestDistSq) + 1e-6;
      const desired = 2.2;
      const stretch = dist - desired;
      const k = (stretch * SETTLEMENT_ORBIT_STRENGTH * entropyFactor) / dist;
      forces[i][0] += dx * k;
      forces[i][1] += dy * k;
      forces[i][2] += dz * k;
    }
  }

  // ===== GENESIS PULSE =====
  // Genesis nodes emit a slow radial "breathing" — a periodic outward then
  // inward pulse applied to *all* nodes proportional to inverse distance.
  // This produces the visual sense of a heartbeat propagating through the
  // entire network. Layered on top of base attraction.
  for (const i of genesisIdxs) {
    const g = nodes[i];
    const phase = Math.sin(2 * Math.PI * GENESIS_PULSE_FREQ * _t);
    for (let j = 0; j < nodes.length; j++) {
      if (j === i) continue;
      const other = nodes[j];
      if (other.health !== 'healthy') continue;
      const dx = other.position[0] - g.position[0];
      const dy = other.position[1] - g.position[1];
      const dz = other.position[2] - g.position[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      const falloff = 1 / (1 + dist * 0.4);
      const k = (phase * GENESIS_PULSE_AMP * falloff * entropyFactor) / dist;
      forces[j][0] += dx * k;
      forces[j][1] += dy * k;
      forces[j][2] += dz * k;
    }
  }
}

/** Reset internal state — call when topology is reinitialized. */
export function resetTypeForces(): void {
  dartTargets.clear();
  _t = 0;
}
