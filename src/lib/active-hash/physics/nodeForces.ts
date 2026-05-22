import { NODE_TYPES } from "../constants/nodeTypes";
import type { AhinLink, AhinNode } from "../types/network";
import type { SolverParams } from "./forceGraph";

type ForceBuffer = [number, number, number][];

const ECO_PERCEPTION_RADIUS = 6;
const ECO_SEPARATION_RADIUS = 2;
const ECO_COHESION_STRENGTH = 0.5;
const ECO_ALIGNMENT_STRENGTH = 0.35;
const ECO_SEPARATION_STRENGTH = 2.2;
const SENTINEL_SCAN_RADIUS = 7;
const SENTINEL_PUSH_STRENGTH = 1.1;
const ROUTING_DART_STRENGTH = 1.5;
const SETTLEMENT_ORBIT_STRENGTH = 1.2;

export function applyTypeForces(nodes: AhinNode[], _links: AhinLink[], forces: ForceBuffer, params: SolverParams): void {
  const entropyFactor = 1 - params.entropy;
  const ecoIdxs: number[] = [];
  const sentinelIdxs: number[] = [];
  const routingIdxs: number[] = [];
  const settlementIdxs: number[] = [];
  const genesisIdxs: number[] = [];

  nodes.forEach((node, index) => {
    if (node.health !== "healthy") return;
    if (node.type === "eco") ecoIdxs.push(index);
    if (node.type === "sentinel") sentinelIdxs.push(index);
    if (node.type === "routing") routingIdxs.push(index);
    if (node.type === "settlement") settlementIdxs.push(index);
    if (node.type === "genesis") genesisIdxs.push(index);
  });

  for (const i of ecoIdxs) {
    const me = nodes[i];
    let cohesion: [number, number, number] = [0, 0, 0];
    let alignment: [number, number, number] = [0, 0, 0];
    let separation: [number, number, number] = [0, 0, 0];
    let neighborCount = 0;

    for (const j of ecoIdxs) {
      if (i === j) continue;
      const other = nodes[j];
      const dx = other.position[0] - me.position[0];
      const dy = other.position[1] - me.position[1];
      const dz = other.position[2] - me.position[2];
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > ECO_PERCEPTION_RADIUS * ECO_PERCEPTION_RADIUS) continue;
      neighborCount++;
      cohesion = [cohesion[0] + other.position[0], cohesion[1] + other.position[1], cohesion[2] + other.position[2]];
      alignment = [alignment[0] + other.velocity[0], alignment[1] + other.velocity[1], alignment[2] + other.velocity[2]];
      if (distSq < ECO_SEPARATION_RADIUS * ECO_SEPARATION_RADIUS && distSq > 0.001) {
        const dist = Math.sqrt(distSq);
        const k = (ECO_SEPARATION_RADIUS - dist) / dist;
        separation = [separation[0] - dx * k, separation[1] - dy * k, separation[2] - dz * k];
      }
    }

    if (neighborCount > 0) {
      forces[i][0] += ((cohesion[0] / neighborCount - me.position[0]) * ECO_COHESION_STRENGTH + (alignment[0] / neighborCount - me.velocity[0]) * ECO_ALIGNMENT_STRENGTH) * entropyFactor;
      forces[i][1] += ((cohesion[1] / neighborCount - me.position[1]) * ECO_COHESION_STRENGTH + (alignment[1] / neighborCount - me.velocity[1]) * ECO_ALIGNMENT_STRENGTH) * entropyFactor;
      forces[i][2] += ((cohesion[2] / neighborCount - me.position[2]) * ECO_COHESION_STRENGTH + (alignment[2] / neighborCount - me.velocity[2]) * ECO_ALIGNMENT_STRENGTH) * entropyFactor;
      forces[i][0] += separation[0] * ECO_SEPARATION_STRENGTH;
      forces[i][1] += separation[1] * ECO_SEPARATION_STRENGTH;
      forces[i][2] += separation[2] * ECO_SEPARATION_STRENGTH;
    }
  }

  for (const i of sentinelIdxs) {
    const sentinel = nodes[i];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j || nodes[j].type === "sentinel" || nodes[j].health !== "healthy") continue;
      const dx = nodes[j].position[0] - sentinel.position[0];
      const dy = nodes[j].position[1] - sentinel.position[1];
      const dz = nodes[j].position[2] - sentinel.position[2];
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq >= SENTINEL_SCAN_RADIUS * SENTINEL_SCAN_RADIUS || distSq < 0.001) continue;
      const dist = Math.sqrt(distSq);
      const k = (1 - dist / SENTINEL_SCAN_RADIUS) * SENTINEL_PUSH_STRENGTH * entropyFactor;
      forces[j][0] += (dx / dist) * k;
      forces[j][1] += (dy / dist) * k;
      forces[j][2] += (dz / dist) * k;
    }
  }

  for (const i of routingIdxs) {
    const node = nodes[i];
    const phase = node.seed * Math.PI * 2 + performanceSafeTime() * 0.001;
    forces[i][0] += Math.cos(phase) * ROUTING_DART_STRENGTH * entropyFactor;
    forces[i][2] += Math.sin(phase * 1.17) * ROUTING_DART_STRENGTH * entropyFactor;
  }

  for (const i of settlementIdxs) {
    const node = nodes[i];
    const nearest = nodes
      .filter((candidate) => candidate.id !== node.id && candidate.type !== "settlement" && candidate.health === "healthy")
      .sort((a, b) => distanceSq(node, a) - distanceSq(node, b))[0];
    if (!nearest) continue;
    forces[i][0] += (nearest.position[0] - node.position[0]) * SETTLEMENT_ORBIT_STRENGTH * 0.08;
    forces[i][1] += (nearest.position[1] - node.position[1]) * SETTLEMENT_ORBIT_STRENGTH * 0.08;
    forces[i][2] += (nearest.position[2] - node.position[2]) * SETTLEMENT_ORBIT_STRENGTH * 0.08;
  }

  for (const i of genesisIdxs) {
    const node = nodes[i];
    const cfg = NODE_TYPES.genesis;
    forces[i][1] += Math.sin(performanceSafeTime() * 0.001 + node.seed) * cfg.forces.charge * 0.002;
  }
}

function distanceSq(a: AhinNode, b: AhinNode) {
  const dx = b.position[0] - a.position[0];
  const dy = b.position[1] - a.position[1];
  const dz = b.position[2] - a.position[2];
  return dx * dx + dy * dy + dz * dz;
}

function performanceSafeTime() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
