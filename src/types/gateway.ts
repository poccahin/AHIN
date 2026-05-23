/**
 * Core type definitions for the AHIN (Active Hashed Interaction Networks) gateway.
 * Phase 1: Topology + Node System.
 */

import type { Vector3Tuple } from 'three';

/** The five node archetypes in the Life++ protocol. */
export type NodeType = 'genesis' | 'sentinel' | 'routing' | 'settlement' | 'eco';

/**
 * Health state of an individual node. Drives the renderer's ownership of
 * this node's voxels and whether it participates in the force graph.
 *
 *   healthy      → InstancedMesh owns voxels with ++ eyes, in force graph
 *   detection    → InstancedMesh owns voxels with -- eyes (T+0..T+0.5),
 *                  detached from force graph, frozen in place
 *   collapsing   → ShatteringNode owns voxels as Rapier rigid bodies
 *                  (T+0.5..T+2.5); InstancedMesh hides this node
 *   banished     → about to be removed from the store entirely
 */
export type NodeHealth =
  | 'healthy'
  | 'detection'
  | 'collapsing'
  | 'banished';

/** A single Cognitive Hash Block in the network. */
export interface AhinNode {
  id: string;
  type: NodeType;
  health: NodeHealth;
  /** World-space position. Mutated in-place by the force solver each tick. */
  position: Vector3Tuple;
  /** Linear velocity. Mutated by force integrator. */
  velocity: Vector3Tuple;
  /** Mass — affects how strongly forces displace this node. */
  mass: number;
  /** Visual size multiplier applied to the voxel grid scale. */
  scale: number;
  /** Cosmetic seed for per-node random offsets (eye-blink phase, aura jitter, etc.). */
  seed: number;
}

/** A directed/undirected interaction edge between two nodes. */
export interface AhinLink {
  id: string;
  sourceId: string;
  targetId: string;
  /** 0..1 — how "lit up" this link currently is. Decays each frame. */
  intensity: number;
  /** Phase of the traveling light pulse along the link (0..1). */
  pulsePhase: number;
  /** If true, the link is in a slashing/error state — render blood red. */
  errored: boolean;
}

/** Phase identifier for the PoCC slashing sequence on a single node. */
export type SlashPhase =
  | 'detection'        // T+0.0s: eyes flip, links go red
  | 'collapse'         // T+0.5s: voxels detach, gravity enabled, ash burst
  | 'banishment'       // T+2.0s: impulse blast outward
  | 'done';            // cleanup

/** Identifiers for boardroom milestone presentation states. */
export type MilestoneId = 'genesis-ignition' | 'causal-guard' | 'macro-evolution';

/** Static, type-level configuration. Resolved once at module-load via nodeTypes.ts. */
export interface NodeTypeConfig {
  type: NodeType;
  /** Human-readable label, used in HUD and debug overlays. */
  label: string;
  /** Bilingual label (Chinese) for milestone synchronization. */
  labelZh: string;
  /** Primary hex color. */
  color: number;
  /** Secondary emissive tint for material highlights. */
  emissive: number;
  /** Default number of instances of this type in the topology. */
  defaultCount: number;
  /** Default mass — higher = harder to push. */
  mass: number;
  /** Force-graph coefficients applied to/from this node. */
  forces: {
    /** Charge: negative = repel, positive = attract. Applied to all other nodes. */
    charge: number;
    /** Multiplier for ideal link length when this node is an endpoint. */
    linkDistanceMul: number;
    /** Optional self-behavior coefficient (e.g. boids strength for eco). */
    selfCoefficient?: number;
  };
}
