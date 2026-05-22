"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import { getVoxels } from "@/src/lib/active-hash/constants/shapes";
import { buildMaterial } from "@/src/lib/active-hash/shaders/voxelMaterial";
import type { SlashRecord } from "@/src/lib/active-hash/state/slashStore";

interface ShatteringNodeProps {
  record: SlashRecord;
  frame: number;
}

function projectedPosition(record: SlashRecord) {
  return {
    x: record.position[0] * 24,
    y: record.position[1] * -18 + record.position[2] * 1.8
  };
}

export function ShatteringNode({ record, frame }: ShatteringNodeProps) {
  const voxels = useMemo(() => getVoxels(record.type, "collapsing"), [record.type]);
  const projected = projectedPosition(record);

  return (
    <div
      className="active-hash-shatter"
      style={
        {
          "--shatter-x": `${projected.x}px`,
          "--shatter-y": `${projected.y}px`,
          "--shatter-scale": String(record.scale),
          "--shatter-frame": String(frame)
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <span className="active-hash-slash-label is-collapse">ChainRank impact simulated · no asset movement</span>
      {voxels.map((voxel, index) => {
        const material = buildMaterial(record.type, voxel.kind);
        const radial = Math.hypot(voxel.gx, voxel.gy) || 1;
        const directionX = voxel.gx / radial;
        const directionY = -voxel.gy / radial;
        const jitter = ((record.seed * 1000 + index * 37) % 19) - 9;
        return (
          <span
            key={`${record.id}-chunk-${voxel.gx}:${voxel.gy}:${voxel.kind}`}
            className={`active-hash-shatter-chunk ${material.className}`}
            style={
              {
                "--voxel-color": material.color,
                "--voxel-emissive": material.emissive,
                "--voxel-opacity": String(material.opacity),
                "--chunk-x": `${voxel.gx * 6}px`,
                "--chunk-y": `${-voxel.gy * 6}px`,
                "--chunk-tx": `${directionX * (34 + (index % 7) * 6 + jitter)}px`,
                "--chunk-ty": `${directionY * (38 + (index % 5) * 7) + 24}px`,
                "--chunk-rot": `${jitter * 9}deg`,
                "--chunk-delay": `${(index % 11) * 12}ms`
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
