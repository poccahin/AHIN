"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NODE_TYPES } from "@/src/lib/active-hash/constants/nodeTypes";
import { DEFAULT_PARAMS, stepForceGraph } from "@/src/lib/active-hash/physics/forceGraph";
import { useNetworkStore } from "@/src/lib/active-hash/state/networkStore";
import type { AhinNode } from "@/src/lib/active-hash/types/network";
import { ParticleField } from "./ParticleField";
import { VoxelInstancedField } from "./VoxelInstancedField";

export function Scene() {
  const nodes = useNetworkStore((state) => state.nodes);
  const links = useNetworkStore((state) => state.links);
  const timelineT = useNetworkStore((state) => state.timelineT);
  const reset = useNetworkStore((state) => state.reset);
  const setTimelineT = useNetworkStore((state) => state.setTimelineT);
  const [frame, setFrame] = useState(0);
  const lastFrame = useRef<number | null>(null);

  useEffect(() => {
    let animationFrame = 0;
    function tick(now: number) {
      const last = lastFrame.current ?? now;
      const dt = Math.min((now - last) / 1000, 1 / 30);
      lastFrame.current = now;
      const state = useNetworkStore.getState();
      stepForceGraph(state.nodes, state.links, dt, {
        ...DEFAULT_PARAMS,
        entropy: 1 - state.timelineT
      });
      setFrame((value) => (value + 1) % 100000);
      animationFrame = window.requestAnimationFrame(tick);
    }
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  const projectedLinks = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return links
      .map((link) => {
        const source = nodeById.get(link.sourceId);
        const target = nodeById.get(link.targetId);
        if (!source || !target) return null;
        return {
          id: link.id,
          source,
          target,
          intensity: link.intensity,
          pulsePhase: link.pulsePhase
        };
      })
      .filter((link): link is { id: string; source: AhinNode; target: AhinNode; intensity: number; pulsePhase: number } => Boolean(link));
  }, [frame, links, nodes]);

  return (
    <section className="active-hash-scene-shell" aria-label="Readonly Active Hash Interaction Network force graph">
      <div className="active-hash-scene-toolbar">
        <div>
          <span>Active Hash Interaction Network</span>
          <strong>Readonly force-graph simulator</strong>
        </div>
        <label>
          entropy
          <input type="range" min="0" max="1" step="0.01" value={1 - timelineT} onChange={(event) => setTimelineT(1 - Number(event.target.value))} />
        </label>
        <button type="button" onClick={reset}>
          reset local topology
        </button>
      </div>

      <div className="active-hash-stage" role="img" aria-label="Voxel nodes and particle aura rendered from local simulator state">
        <svg className="active-hash-link-layer" viewBox="-520 -310 1040 620" aria-hidden="true">
          {projectedLinks.map((link) => {
            const x1 = link.source.position[0] * 24;
            const y1 = link.source.position[1] * -18 + link.source.position[2] * 1.8;
            const x2 = link.target.position[0] * 24;
            const y2 = link.target.position[1] * -18 + link.target.position[2] * 1.8;
            const color = NODE_TYPES[link.target.type].color;
            return (
              <g key={link.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeOpacity={0.12 + link.intensity * 0.26} strokeWidth="1" />
                <circle cx={x1 + (x2 - x1) * link.pulsePhase} cy={y1 + (y2 - y1) * link.pulsePhase} r="2.8" fill={color} opacity="0.68" />
              </g>
            );
          })}
        </svg>
        <ParticleField nodes={nodes} />
        <VoxelInstancedField nodes={nodes} frame={frame} />
      </div>
    </section>
  );
}
