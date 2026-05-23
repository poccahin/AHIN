/**
 * Configuration table for the five AHIN node types.
 *
 * Colors are taken from the user-supplied brief:
 *   - Genesis     #FF5722  initial-orange  (创世橙 / Genesis Orange)
 *   - Sentinel    #9C27B0  rule-purple     (天则紫 / Rule Purple)
 *   - Routing     #03A9F4  compute-blue    (算流蓝 / Compute Blue)
 *   - Settlement  #FFC107  contract-gold   (定约金 / Contract Gold)
 *   - Eco         #8BC34A  spirit-green    (灵根绿 / Eco Green)
 *
 * Forces are tuned for an aesthetically pleasing equilibrium:
 *   - Genesis is the global attractor (strong positive charge), acting as
 *     the "Godsignal" — all nodes orbit it.
 *   - Sentinel is heavy and weakly repulsive, scanning for conflicts.
 *   - Routing is light and zippy with strong link affinity (it darts).
 *   - Settlement is sticky — strong link affinity, short ideal distance.
 *   - Eco is moderate mass with self-flocking enabled (handled separately).
 */

import type { NodeTypeConfig, NodeType } from '@/src/types/gateway';

export const NODE_TYPES: Record<NodeType, NodeTypeConfig> = {
  genesis: {
    type: 'genesis',
    label: 'Genesis',
    labelZh: '创世',
    color: 0xff5722,
    emissive: 0xff8a4c,
    defaultCount: 1,        // typically a singleton — the Godsignal
    mass: 4.0,
    forces: {
      charge: 80,           // strong positive: attracts everything globally
      linkDistanceMul: 1.4,
    },
  },
  sentinel: {
    type: 'sentinel',
    label: 'Sentinel',
    labelZh: '天则',
    color: 0x9c27b0,
    emissive: 0xc77ed1,
    defaultCount: 4,
    mass: 6.0,              // heavy — moves slowly
    forces: {
      charge: -10,          // mildly repulsive — pushes conflicting neighbors
      linkDistanceMul: 1.0,
    },
  },
  routing: {
    type: 'routing',
    label: 'Routing',
    labelZh: '算流',
    color: 0x03a9f4,
    emissive: 0x6bcdff,
    defaultCount: 10,       // many — they're the workhorses
    mass: 0.7,              // light — darts around quickly
    forces: {
      charge: -3,
      linkDistanceMul: 0.7,
    },
  },
  settlement: {
    type: 'settlement',
    label: 'Settlement',
    labelZh: '定约',
    color: 0xffc107,
    emissive: 0xffe082,
    defaultCount: 5,
    mass: 2.5,
    forces: {
      charge: -2,
      linkDistanceMul: 0.5, // very short ideal distance — sticky binary orbits
    },
  },
  eco: {
    type: 'eco',
    label: 'Eco',
    labelZh: '灵根',
    color: 0x8bc34a,
    emissive: 0xc5e1a5,
    defaultCount: 12,
    mass: 1.2,
    forces: {
      charge: -4,
      linkDistanceMul: 1.0,
      selfCoefficient: 1.2, // boids flocking strength among eco nodes
    },
  },
};

export const NODE_TYPE_LIST: NodeType[] = [
  'genesis',
  'sentinel',
  'routing',
  'settlement',
  'eco',
];

/** Total default node count across all types. ~32 nodes — enough density to feel alive. */
export const DEFAULT_TOTAL_NODES = NODE_TYPE_LIST.reduce(
  (sum, t) => sum + NODE_TYPES[t].defaultCount,
  0,
);

/** World-space radius for the spherical volume the force solver operates within. */
export const WORLD_RADIUS = 18;

/** Maximum number of simultaneous links rendered. Excess are culled by intensity. */
export const MAX_LINKS = 64;

/** Background color of the 3D vacuum. Near-black with the faintest cool tint. */
export const BACKGROUND_COLOR = 0x05060a;
