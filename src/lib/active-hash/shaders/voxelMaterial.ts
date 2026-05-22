import { NODE_TYPES } from "../constants/nodeTypes";
import type { VoxelKind } from "../constants/shapes";
import type { NodeType } from "../types/network";

export interface VoxelMaterialDescriptor {
  className: string;
  color: string;
  emissive: string;
  opacity: number;
}

export function buildMaterial(type: NodeType, kind: VoxelKind): VoxelMaterialDescriptor {
  const config = NODE_TYPES[type];
  if (kind === "face") {
    return {
      className: "is-face",
      color: "#f6f4ee",
      emissive: "rgba(246, 244, 238, 0.72)",
      opacity: 0.96
    };
  }
  if (kind === "glyph") {
    return {
      className: "is-glyph",
      color: config.color,
      emissive: config.color,
      opacity: 1
    };
  }
  return {
    className: "is-body",
    color: config.color,
    emissive: `rgba(${config.rgb[0]}, ${config.rgb[1]}, ${config.rgb[2]}, 0.52)`,
    opacity: 0.88
  };
}

export function updateMaterialAnimations(_elapsed: number): void {
  // CSS animations own the readonly simulator material pulse in this import.
}
