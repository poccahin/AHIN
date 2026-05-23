/**
 * Voxel occupancy masks — the "character" geometry for each node type.
 *
 * Each shape is defined as a 2D silhouette (the front face), which is then
 * extruded along Z to give it a chunky pixel-art appearance matching the
 * reference imagery (the green ++ creature and red -- slashed creature).
 *
 * The silhouette is a 16×16 boolean grid:
 *   - Row 0 = top, row 15 = bottom
 *   - Col 0 = left, col 15 = right
 *   - '#' = solid voxel, '.' = empty
 *
 * The "eyes" panel (the inset white face from the reference) is carved out
 * separately at render time so we can swap ++ / -- glyphs without rebuilding
 * the geometry. See `EYE_REGION` and `EYE_GLYPHS` below.
 *
 * Extrusion depth (Z-thickness) is small (~4 voxels) so nodes read as
 * billboarded characters from any angle, like the reference art.
 */

import type { NodeType } from '@/src/types/gateway';

export const GRID_SIZE = 16;
export const EXTRUSION_DEPTH = 4;

/** Parse a string-art template into a 16×16 boolean grid. */
function parseShape(rows: string[]): boolean[][] {
  if (rows.length !== GRID_SIZE) {
    throw new Error(`Shape must be ${GRID_SIZE} rows, got ${rows.length}`);
  }
  return rows.map((row) => {
    if (row.length !== GRID_SIZE) {
      throw new Error(`Each row must be ${GRID_SIZE} chars, got ${row.length}`);
    }
    return [...row].map((c) => c === '#');
  });
}

/**
 * GENESIS — flame/teardrop silhouette. Tall, tapered top, broad rounded base.
 * Matches the green ++ reference: a fire-shape that suggests warmth and creation.
 */
const GENESIS_SHAPE = parseShape([
  '.......##.......',
  '......####......',
  '......####......',
  '.....######.....',
  '....########....',
  '...##########...',
  '..############..',
  '..############..',
  '.##############.',
  '.##############.',
  '################',
  '################',
  '.##############.',
  '.##############.',
  '..############..',
  '...##########...',
]);

/**
 * SENTINEL — crystalline diamond. Sharp angular silhouette.
 * Suggests authority, structure, and judgment.
 */
const SENTINEL_SHAPE = parseShape([
  '.......##.......',
  '......####......',
  '.....######.....',
  '....########....',
  '...##########...',
  '..############..',
  '.##############.',
  '################',
  '################',
  '.##############.',
  '..############..',
  '...##########...',
  '....########....',
  '.....######.....',
  '......####......',
  '.......##.......',
]);

/**
 * ROUTING — hexagonal/data-packet silhouette. Compact, geometric.
 * Reads as a network packet or routing chip.
 */
const ROUTING_SHAPE = parseShape([
  '....########....',
  '...##########...',
  '..############..',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
  '...##########...',
  '....########....',
]);

/**
 * SETTLEMENT — vault/coin silhouette. Solid, weighted, with a flat top.
 * Suggests stored value and finality.
 */
const SETTLEMENT_SHAPE = parseShape([
  '..############..',
  '..############..',
  '.##############.',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '################',
  '.##############.',
  '..############..',
  '...##########...',
]);

/**
 * ECO — same flame silhouette as Genesis but slightly squatter, suggesting
 * a sprout/seed character. The reference green ++ creature is in this family.
 */
const ECO_SHAPE = parseShape([
  '.......##.......',
  '......####......',
  '......####......',
  '.....######.....',
  '....########....',
  '....########....',
  '...##########...',
  '..############..',
  '..############..',
  '.##############.',
  '.##############.',
  '################',
  '################',
  '.##############.',
  '..############..',
  '...##########...',
]);

export const NODE_SHAPES: Record<NodeType, boolean[][]> = {
  genesis: GENESIS_SHAPE,
  sentinel: SENTINEL_SHAPE,
  routing: ROUTING_SHAPE,
  settlement: SETTLEMENT_SHAPE,
  eco: ECO_SHAPE,
};

/**
 * The "face panel" — a rectangular region carved out of the silhouette where
 * the eye glyphs (++ for healthy, -- for slashing) are rendered as a different
 * material (white/cream) with the glyph cubes recolored.
 *
 * Coordinates: [rowStart, rowEnd, colStart, colEnd], inclusive.
 */
export const EYE_REGION = {
  rowStart: 7,
  rowEnd: 13,
  colStart: 4,
  colEnd: 11,
} as const;

/**
 * Eye glyph patterns — drawn within the 7-wide × 7-tall eye region.
 * Local coordinates relative to EYE_REGION.
 *
 * '#' = glyph cube (rendered in node color, emissive)
 * '.' = face cube (rendered white/cream)
 * ' ' = no voxel (carved out — but for the eye region we keep it solid)
 */
function parseEyeGlyph(rows: string[]): boolean[][] {
  return rows.map((row) => [...row].map((c) => c === '#'));
}

/**
 * Final eye glyph patterns rendered into the front face of every node.
 *
 * Eye region is 7 cols × 7 rows. Two clean `+` glyphs sit at cols 0-2 and
 * cols 4-6, with col 3 empty between them, producing two clearly separated
 * plus signs (matching the green ++ reference image).
 *
 * Healthy renders as:
 *     . . . . . . .
 *     . # . . . # .   ← top arm
 *     # # # . # # #   ← horizontal arm row
 *     . # . . . # .   ← bottom arm
 *     . . . . . . .
 *     . . . . . . .
 *     . . . . . . .
 *
 * Slashed renders as two short horizontal dashes (matching the red --
 * reference image).
 */
export const EYE_GLYPHS = {
  healthy: parseEyeGlyph([
    '.......',
    '.#...#.',
    '###.###',
    '.#...#.',
    '.......',
    '.......',
    '.......',
  ]),
  slashed: parseEyeGlyph([
    '.......',
    '.......',
    '.##.##.',
    '.##.##.',
    '.......',
    '.......',
    '.......',
  ]),
};

/**
 * Compute the full 3D voxel list for a node type.
 *
 * Returns an array of voxel descriptors with their grid coordinates and a
 * classification flag indicating whether each voxel is part of:
 *   - 'body'  → rendered in the node's primary color/material
 *   - 'face'  → rendered in the white/cream face material
 *   - 'glyph' → rendered in the node's emissive color (the ++ or -- shape)
 *
 * The extrusion depth means each silhouette voxel becomes a column of
 * EXTRUSION_DEPTH voxels along Z. The face panel only exists on the front
 * slice (highest Z) so the eyes only appear on one face, matching the
 * reference imagery.
 */
export type VoxelKind = 'body' | 'face' | 'glyph';

export interface Voxel {
  /** Integer grid coordinates, with origin at the node center. */
  gx: number;
  gy: number;
  gz: number;
  kind: VoxelKind;
}

const FRONT_Z = EXTRUSION_DEPTH - 1;

/**
 * Build the voxel list for a node type with the specified eye state.
 *
 * Coordinates are returned centered: gx ranges roughly [-GRID_SIZE/2, GRID_SIZE/2],
 * same for gy, and gz ranges [-EXTRUSION_DEPTH/2, EXTRUSION_DEPTH/2].
 */
export function buildVoxels(
  type: NodeType,
  eyeState: 'healthy' | 'slashed' = 'healthy',
): Voxel[] {
  const shape = NODE_SHAPES[type];
  const glyph = EYE_GLYPHS[eyeState];
  const voxels: Voxel[] = [];

  const halfGrid = GRID_SIZE / 2;
  const halfDepth = EXTRUSION_DEPTH / 2;

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      if (!shape[row][col]) continue;

      // Determine if (row, col) falls inside the eye region.
      const inEyeRegion =
        row >= EYE_REGION.rowStart &&
        row <= EYE_REGION.rowEnd &&
        col >= EYE_REGION.colStart &&
        col <= EYE_REGION.colEnd;

      for (let z = 0; z < EXTRUSION_DEPTH; z++) {
        // Center the grid around (0, 0, 0).
        const gx = col - halfGrid + 0.5;
        // Invert Y so row 0 (top) maps to positive Y.
        const gy = halfGrid - row - 0.5;
        const gz = z - halfDepth + 0.5;

        let kind: VoxelKind = 'body';

        if (inEyeRegion && z === FRONT_Z) {
          // Front face of the eye region.
          const eyeRow = row - EYE_REGION.rowStart;
          const eyeCol = col - EYE_REGION.colStart;
          if (glyph[eyeRow]?.[eyeCol]) {
            kind = 'glyph';
          } else {
            kind = 'face';
          }
        }

        voxels.push({ gx, gy, gz, kind });
      }
    }
  }

  return voxels;
}

/**
 * Cache of voxel lists keyed by `${type}:${eyeState}`.
 * Built lazily on first request. The arrays are immutable — they describe
 * the static "rest pose" of a node. Motion is applied at the InstancedMesh
 * matrix level, not by mutating these.
 */
const VOXEL_CACHE = new Map<string, Voxel[]>();

export function getVoxels(
  type: NodeType,
  eyeState: 'healthy' | 'slashed' = 'healthy',
): Voxel[] {
  const key = `${type}:${eyeState}`;
  let cached = VOXEL_CACHE.get(key);
  if (!cached) {
    cached = buildVoxels(type, eyeState);
    VOXEL_CACHE.set(key, cached);
  }
  return cached;
}
