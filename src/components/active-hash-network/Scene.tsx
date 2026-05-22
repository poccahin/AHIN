"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_PARAMS, stepForceGraph } from "@/src/lib/active-hash/physics/forceGraph";
import { useNetworkStore } from "@/src/lib/active-hash/state/networkStore";
import { useSlashStore } from "@/src/lib/active-hash/state/slashStore";
import { Links } from "./Links";
import { ParticleField } from "./ParticleField";
import { SlashingSequence } from "./SlashingSequence";
import { VoxelInstancedField } from "./VoxelInstancedField";

export function Scene() {
  const nodes = useNetworkStore((state) => state.nodes);
  const links = useNetworkStore((state) => state.links);
  const timelineT = useNetworkStore((state) => state.timelineT);
  const setTimelineT = useNetworkStore((state) => state.setTimelineT);
  const resetSlashSimulation = useSlashStore((state) => state.resetSlashSimulation);
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
      useSlashStore.getState().tick(now / 1000);
      setFrame((value) => (value + 1) % 100000);
      animationFrame = window.requestAnimationFrame(tick);
    }
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

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
        <button type="button" onClick={resetSlashSimulation}>
          reset local topology
        </button>
      </div>

      <div className="active-hash-stage" role="img" aria-label="Voxel nodes and particle aura rendered from local simulator state">
        <Links nodes={nodes} links={links} frame={frame} />
        <ParticleField nodes={nodes} />
        <VoxelInstancedField nodes={nodes} frame={frame} />
        <SlashingSequence frame={frame} />
      </div>
    </section>
  );
}
