'use client';

/**
 * SlashingSequence — the per-frame orchestrator for the slashing pipeline.
 *
 * Responsibilities:
 *   1. Drive `slashStore.tick(elapsed)` every frame so phase transitions
 *      (DETECTION → COLLAPSE → BANISHED) actually happen.
 *   2. For each active slash record currently in the COLLAPSE phase, mount
 *      one ShatteringNode (physics-driven voxel chunks) and one AshBurst
 *      (ember particles) at the frozen position.
 *
 * The components are keyed by node id so React handles mount/unmount
 * transitions automatically — when the slashStore drops a record (because
 * we advanced past COLLAPSE → BANISHED), the corresponding ShatteringNode
 * and AshBurst unmount, releasing their physics bodies and particle
 * buffers.
 *
 * We need the node SNAPSHOT (its type, position, scale at slash time) to
 * build the ShatteringNode geometry. But by COLLAPSE time the slashStore
 * record's `position` field is already the frozen world position, and we
 * can recover the type from networkStore (since the node is still present
 * during DETECTION + COLLAPSE phases — only removed at BANISHED). Once
 * mounted, the ShatteringNode keeps its own snapshot regardless.
 */

import { useFrame } from '@react-three/fiber';
import { useSlashStore } from '@/lib/state/slashStore';
import { useNetworkStore } from '@/lib/state/networkStore';
import { ShatteringNode } from './ShatteringNode';
import { AshBurst } from './AshBurst';
import type { AhinNode } from '@/types/network';

export function SlashingSequence() {
  // Drive phase transitions every frame.
  useFrame((state) => {
    useSlashStore.getState().tick(state.clock.elapsedTime);
  });

  // Subscribe to the records map so we re-render on add/remove/phase change.
  // We use a selector that returns the entries array — Zustand will only
  // re-render this component when the Map identity changes (which we
  // guarantee in the store by always cloning).
  const records = useSlashStore((s) => s.records);
  const nodes = useNetworkStore((s) => s.nodes);

  // Only mount physics + ash for records currently in COLLAPSE phase.
  // (DETECTION is purely a visual change in the instanced field; BANISHED
  // is already cleaned up.)
  const collapsing = [...records.values()].filter((r) => r.phase === 'COLLAPSE');

  // Resolve each record's node snapshot. The node may have been removed
  // already if cleanup raced (defensive: skip those).
  const nodeMap = new Map<string, AhinNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  return (
    <>
      {collapsing.map((rec) => {
        const node = nodeMap.get(rec.id);
        if (!node) return null;
        // Build a frozen-snapshot node from the record + live type info.
        // We use the record's frozen position (set at trigger time) not the
        // node's live position, in case any solver glitch moved it.
        const frozenNode: AhinNode = {
          ...node,
          position: rec.position,
          velocity: [0, 0, 0],
        };
        return (
          <group key={rec.id}>
            <ShatteringNode node={frozenNode} />
            <AshBurst origin={rec.position} />
          </group>
        );
      })}
    </>
  );
}
