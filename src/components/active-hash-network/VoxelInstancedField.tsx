"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import { NODE_TYPES, NODE_TYPE_LIST } from "@/src/lib/active-hash/constants/nodeTypes";
import { getVoxels } from "@/src/lib/active-hash/constants/shapes";
import { buildMaterial } from "@/src/lib/active-hash/shaders/voxelMaterial";
import type { AhinNode, NodeType } from "@/src/lib/active-hash/types/network";

interface VoxelInstancedFieldProps {
  nodes: AhinNode[];
  frame: number;
}

export function VoxelInstancedField({ nodes, frame }: VoxelInstancedFieldProps) {
  const voxelTemplates = useMemo(() => {
    return Object.fromEntries(NODE_TYPE_LIST.map((type) => [type, getVoxels(type)])) as Record<NodeType, ReturnType<typeof getVoxels>>;
  }, []);

  return (
    <div className="active-hash-voxel-layer" aria-label="3D voxel cognition node field">
      {nodes.map((node) => {
        const config = NODE_TYPES[node.type];
        const depth = node.position[2];
        const x = node.position[0] * 24;
        const y = node.position[1] * -18 + depth * 1.8;
        const scale = node.scale * (1 + Math.sin(frame * 0.05 + node.seed * 8) * 0.018) * (1 + depth / 120);
        return (
          <button
            key={node.id}
            type="button"
            className={`active-hash-node node-${node.type}`}
            style={{
              "--node-color": config.color,
              "--node-x": `${x}px`,
              "--node-y": `${y}px`,
              "--node-scale": String(scale),
              "--node-depth": String(Math.round(500 + depth * 12))
            } as CSSProperties}
            aria-label={`${config.label} ${config.role} readonly node`}
          >
            <span className="active-hash-node-label">
              <strong>{config.label}</strong>
              <small>{config.role}</small>
            </span>
            <span className="voxel-grid" aria-hidden="true">
              {voxelTemplates[node.type].map((voxel) => {
                const material = buildMaterial(node.type, voxel.kind);
                return (
                  <span
                    key={`${voxel.gx}:${voxel.gy}:${voxel.gz}:${voxel.kind}`}
                    className={`voxel-cell ${material.className}`}
                    style={{
                      "--voxel-color": material.color,
                      "--voxel-emissive": material.emissive,
                      "--voxel-opacity": String(material.opacity),
                      gridColumn: voxel.gx + 9,
                      gridRow: 9 - voxel.gy
                    } as CSSProperties}
                  />
                );
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
