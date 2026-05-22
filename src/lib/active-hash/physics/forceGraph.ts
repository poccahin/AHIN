import { NODE_TYPES, WORLD_RADIUS } from "../constants/nodeTypes";
import type { AhinLink, AhinNode } from "../types/network";
import { applyTypeForces } from "./nodeForces";

export interface SolverParams {
  chargeStrength: number;
  linkStrength: number;
  linkRestLength: number;
  centeringStrength: number;
  damping: number;
  maxSpeed: number;
  entropy: number;
  worldRadius: number;
}

export const DEFAULT_PARAMS: SolverParams = {
  chargeStrength: 1.45,
  linkStrength: 0.35,
  linkRestLength: 4.5,
  centeringStrength: 0.025,
  damping: 0.92,
  maxSpeed: 13,
  entropy: 0,
  worldRadius: WORLD_RADIUS
};

const MAX_DT = 1 / 30;
const MIN_SEPARATION = 0.5;

export function stepForceGraph(nodes: AhinNode[], links: AhinLink[], dt: number, params: SolverParams = DEFAULT_PARAMS): void {
  if (nodes.length === 0 || dt <= 0) return;
  const stepDt = Math.min(dt, MAX_DT);
  const entropyFactor = 1 - params.entropy;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const forces: [number, number, number][] = nodes.map(() => [0, 0, 0]);
  const activeIndexes = nodes.map((node, index) => (node.health === "healthy" ? index : -1)).filter((index) => index >= 0);

  for (let a = 0; a < activeIndexes.length; a++) {
    const ia = activeIndexes[a];
    const na = nodes[ia];
    const cfgA = NODE_TYPES[na.type];
    for (let b = a + 1; b < activeIndexes.length; b++) {
      const ib = activeIndexes[b];
      const nb = nodes[ib];
      const cfgB = NODE_TYPES[nb.type];
      const dx = nb.position[0] - na.position[0];
      const dy = nb.position[1] - na.position[1];
      const dz = nb.position[2] - na.position[2];
      const distSq = Math.max(dx * dx + dy * dy + dz * dz, MIN_SEPARATION * MIN_SEPARATION);
      const dist = Math.sqrt(distSq);
      const isGenesisPair = na.type === "genesis" || nb.type === "genesis";
      const effectiveCharge = isGenesisPair
        ? Math.max(cfgA.forces.charge, cfgB.forces.charge) * params.chargeStrength
        : ((cfgA.forces.charge + cfgB.forces.charge) * 0.5 * params.chargeStrength);
      const forceMag = (effectiveCharge / distSq) * entropyFactor;
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
  }

  for (const link of links) {
    const source = nodeById.get(link.sourceId);
    const target = nodeById.get(link.targetId);
    if (!source || !target || source.health !== "healthy" || target.health !== "healthy") continue;
    const ia = nodes.indexOf(source);
    const ib = nodes.indexOf(target);
    const dx = target.position[0] - source.position[0];
    const dy = target.position[1] - source.position[1];
    const dz = target.position[2] - source.position[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.000001;
    const restLen =
      params.linkRestLength *
      Math.min(NODE_TYPES[source.type].forces.linkDistanceMul, NODE_TYPES[target.type].forces.linkDistanceMul);
    const forceMag = (dist - restLen) * params.linkStrength * entropyFactor * (link.errored ? -0.4 : 1);
    forces[ia][0] += (dx / dist) * forceMag;
    forces[ia][1] += (dy / dist) * forceMag;
    forces[ia][2] += (dz / dist) * forceMag;
    forces[ib][0] -= (dx / dist) * forceMag;
    forces[ib][1] -= (dy / dist) * forceMag;
    forces[ib][2] -= (dz / dist) * forceMag;
    link.pulsePhase = (link.pulsePhase + stepDt * 0.12) % 1;
    link.intensity = Math.max(0.18, link.intensity * 0.995);
  }

  for (const i of activeIndexes) {
    const node = nodes[i];
    forces[i][0] -= node.position[0] * params.centeringStrength;
    forces[i][1] -= node.position[1] * params.centeringStrength;
    forces[i][2] -= node.position[2] * params.centeringStrength;
  }

  applyTypeForces(nodes, links, forces, params);

  if (params.entropy > 0) {
    const noiseMagnitude = params.entropy * 3.5;
    for (const i of activeIndexes) {
      const node = nodes[i];
      forces[i][0] += (seedWave(node.seed, 0) * 2 - 1) * noiseMagnitude;
      forces[i][1] += (seedWave(node.seed, 1) * 2 - 1) * noiseMagnitude;
      forces[i][2] += (seedWave(node.seed, 2) * 2 - 1) * noiseMagnitude;
    }
  }

  for (const i of activeIndexes) {
    const node = nodes[i];
    const radius = Math.sqrt(node.position[0] ** 2 + node.position[1] ** 2 + node.position[2] ** 2);
    if (radius > params.worldRadius) {
      const pull = (radius - params.worldRadius) * 0.5;
      forces[i][0] -= (node.position[0] / radius) * pull;
      forces[i][1] -= (node.position[1] / radius) * pull;
      forces[i][2] -= (node.position[2] / radius) * pull;
    }
  }

  for (const i of activeIndexes) {
    const node = nodes[i];
    const invMass = 1 / node.mass;
    node.velocity[0] += forces[i][0] * invMass * stepDt;
    node.velocity[1] += forces[i][1] * invMass * stepDt;
    node.velocity[2] += forces[i][2] * invMass * stepDt;
    const speedSq = node.velocity[0] ** 2 + node.velocity[1] ** 2 + node.velocity[2] ** 2;
    if (speedSq > params.maxSpeed * params.maxSpeed) {
      const clamp = params.maxSpeed / Math.sqrt(speedSq);
      node.velocity[0] *= clamp;
      node.velocity[1] *= clamp;
      node.velocity[2] *= clamp;
    }
    node.position[0] += node.velocity[0] * stepDt;
    node.position[1] += node.velocity[1] * stepDt;
    node.position[2] += node.velocity[2] * stepDt;
    const dampFactor = Math.pow(params.damping, stepDt * 60);
    node.velocity[0] *= dampFactor;
    node.velocity[1] *= dampFactor;
    node.velocity[2] *= dampFactor;
  }
}

function seedWave(seed: number, axis: number) {
  const t = typeof performance === "undefined" ? Date.now() : performance.now();
  return Math.sin(seed * 997 + axis * 83 + t * 0.0017) * 0.5 + 0.5;
}
