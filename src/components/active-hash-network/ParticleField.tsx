"use client";

import type { CSSProperties } from "react";
import { NODE_TYPES } from "@/src/lib/active-hash/constants/nodeTypes";
import type { AhinNode } from "@/src/lib/active-hash/types/network";

interface ParticleFieldProps {
  nodes: AhinNode[];
}

const PARTICLES_PER_NODE = 5;

export function ParticleField({ nodes }: ParticleFieldProps) {
  return (
    <div className="active-hash-particle-layer" aria-hidden="true">
      {nodes.flatMap((node) => {
        if (node.health === "collapsing" || node.health === "banished") return [];
        const config = NODE_TYPES[node.type];
        return Array.from({ length: PARTICLES_PER_NODE }, (_, index) => {
          const angle = node.seed * 360 + index * 73;
          const radius = 22 + index * 8 + node.scale * 10;
          const x = node.position[0] * 24 + Math.cos((angle * Math.PI) / 180) * radius;
          const y = node.position[1] * -18 + Math.sin((angle * Math.PI) / 180) * radius * 0.65;
          return (
            <span
              key={`${node.id}-particle-${index}`}
              className={`active-hash-particle particle-${node.type}`}
              style={
                {
                  "--particle-x": `${x}px`,
                  "--particle-y": `${y}px`,
                  "--particle-color": config.color,
                  "--particle-delay": `${(node.seed + index * 0.17).toFixed(3)}s`
                } as CSSProperties
              }
            />
          );
        });
      })}
    </div>
  );
}
