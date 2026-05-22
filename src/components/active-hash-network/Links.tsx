"use client";

import { NODE_TYPES } from "@/src/lib/active-hash/constants/nodeTypes";
import type { AhinLink, AhinNode } from "@/src/lib/active-hash/types/network";

interface LinksProps {
  nodes: AhinNode[];
  links: AhinLink[];
  frame: number;
}

function project(node: AhinNode) {
  return {
    x: node.position[0] * 24,
    y: node.position[1] * -18 + node.position[2] * 1.8
  };
}

export function Links({ nodes, links, frame }: LinksProps) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return (
    <svg className="active-hash-link-layer" viewBox="-520 -310 1040 620" aria-hidden="true">
      {links.map((link) => {
        const source = nodeById.get(link.sourceId);
        const target = nodeById.get(link.targetId);
        if (!source || !target || source.health === "collapsing" || target.health === "collapsing" || source.health === "banished" || target.health === "banished") {
          return null;
        }
        const start = project(source);
        const end = project(target);
        const color = link.errored ? "#ff2c35" : NODE_TYPES[target.type].color;
        const pulse = link.errored ? 0.5 + Math.sin(frame * 0.34 + link.pulsePhase * 12) * 0.07 : link.pulsePhase;
        const midX = start.x + (end.x - start.x) * pulse;
        const midY = start.y + (end.y - start.y) * pulse;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        const vibration = link.errored ? Math.sin(frame * 0.92 + link.pulsePhase * 20) * 7 : 0;
        const controlX = (start.x + end.x) / 2 + (-dy / length) * vibration;
        const controlY = (start.y + end.y) / 2 + (dx / length) * vibration;

        return (
          <g key={link.id} className={link.errored ? "active-hash-link is-errored" : "active-hash-link"}>
            <path
              d={`M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`}
              fill="none"
              stroke={color}
              strokeOpacity={link.errored ? 0.82 : 0.12 + link.intensity * 0.26}
              strokeWidth={link.errored ? 1.65 : 1}
            />
            <circle cx={midX} cy={midY} r={link.errored ? 4 : 2.8} fill={color} opacity={link.errored ? 0.9 : 0.68} />
          </g>
        );
      })}
    </svg>
  );
}
