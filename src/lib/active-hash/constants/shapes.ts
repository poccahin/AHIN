import type { NodeHealth, NodeType } from "../types/network";

export const GRID_SIZE = 16;
export const EXTRUSION_DEPTH = 2;

function parseShape(rows: string[]): boolean[][] {
  if (rows.length !== GRID_SIZE) {
    throw new Error(`Shape must be ${GRID_SIZE} rows, got ${rows.length}`);
  }
  return rows.map((row) => {
    if (row.length !== GRID_SIZE) {
      throw new Error(`Shape row must be ${GRID_SIZE} chars, got ${row.length}`);
    }
    return [...row].map((cell) => cell === "#");
  });
}

const FLAME = parseShape([
  ".......##.......",
  "......####......",
  "......####......",
  ".....######.....",
  "....########....",
  "...##########...",
  "..############..",
  "..############..",
  ".##############.",
  ".##############.",
  "################",
  "################",
  ".##############.",
  ".##############.",
  "..############..",
  "...##########..."
]);

const DIAMOND = parseShape([
  ".......##.......",
  "......####......",
  ".....######.....",
  "....########....",
  "...##########...",
  "..############..",
  ".##############.",
  "################",
  "################",
  ".##############.",
  "..############..",
  "...##########...",
  "....########....",
  ".....######.....",
  "......####......",
  ".......##......."
]);

const HEX = parseShape([
  "....########....",
  "...##########...",
  "..############..",
  ".##############.",
  "################",
  "################",
  "################",
  "################",
  "################",
  "################",
  "################",
  "################",
  ".##############.",
  "..############..",
  "...##########...",
  "....########...."
]);

const VAULT = parseShape([
  "..############..",
  "..############..",
  ".##############.",
  "################",
  "################",
  "################",
  "################",
  "################",
  "################",
  "################",
  "################",
  "################",
  "################",
  ".##############.",
  "..############..",
  "...##########..."
]);

const SPROUT = parseShape([
  ".......##.......",
  "......####......",
  "......####......",
  ".....######.....",
  "....########....",
  "....########....",
  "...##########...",
  "..############..",
  "..############..",
  ".##############.",
  ".##############.",
  "################",
  "################",
  ".##############.",
  "..############..",
  "...##########..."
]);

export const NODE_SHAPES: Record<NodeType, boolean[][]> = {
  genesis: FLAME,
  sentinel: DIAMOND,
  routing: HEX,
  settlement: VAULT,
  eco: SPROUT
};

export const EYE_REGION = {
  rowStart: 7,
  rowEnd: 13,
  colStart: 4,
  colEnd: 11
} as const;

function parseEyeGlyph(rows: string[]): boolean[][] {
  return rows.map((row) => [...row].map((cell) => cell === "#"));
}

export const EYE_GLYPHS = {
  healthy: parseEyeGlyph([".......", ".#...#.", "###.###", ".#...#.", ".......", ".......", "......."]),
  slashing: parseEyeGlyph([".......", ".......", ".##.##.", ".##.##.", ".......", ".......", "......."])
} as const;

export type VoxelKind = "body" | "face" | "glyph";

export interface Voxel {
  gx: number;
  gy: number;
  gz: number;
  kind: VoxelKind;
}

export function getVoxels(type: NodeType, health: NodeHealth = "healthy"): Voxel[] {
  const shape = NODE_SHAPES[type];
  const glyph = health === "healthy" ? EYE_GLYPHS.healthy : EYE_GLYPHS.slashing;
  const voxels: Voxel[] = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      if (!shape[row][col]) continue;
      const gx = col - GRID_SIZE / 2;
      const gy = GRID_SIZE / 2 - row;
      const inFace =
        row >= EYE_REGION.rowStart &&
        row <= EYE_REGION.rowEnd &&
        col >= EYE_REGION.colStart &&
        col <= EYE_REGION.colEnd;
      let kind: VoxelKind = "body";
      if (inFace) {
        const localRow = row - EYE_REGION.rowStart;
        const localCol = col - EYE_REGION.colStart;
        kind = glyph[localRow]?.[localCol] ? "glyph" : "face";
      }
      voxels.push({ gx, gy, gz: EXTRUSION_DEPTH - 1, kind });
    }
  }

  return voxels;
}
