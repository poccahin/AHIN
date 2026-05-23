'use client';

/**
 * Slash store — the orchestrator for the PoCC (Proof of Causal Consistency)
 * hallucination penalty sequence.
 *
 * Timeline (per slashed node):
 *
 *   T+0.0s  DETECTION
 *     - Node's health flips to 'detection' in networkStore.
 *     - VoxelInstancedField keeps rendering the node BUT swaps the eye
 *       glyph template from healthy → slashed (red `--`).
 *     - The node freezes in place (no longer integrated by forceGraph).
 *     - All links touching the node get errored=true → render blood-red
 *       and vibrate (Links component reads slashStore.flickerPhase).
 *
 *   T+0.5s  COLLAPSE
 *     - Node's health flips to 'collapsing'.
 *     - VoxelInstancedField stops drawing this node (its voxels disappear).
 *     - ShatteringNode mounts at the frozen position: spawns one
 *       <RigidBody> per voxel from the node's shape mask, applies a small
 *       outward burst impulse (so the silhouette explodes outward briefly
 *       before gravity takes over).
 *     - AshBurst mounts: dark amber/grey GPU-instanced particles erupt
 *       upward and outward — "burning digital assets" aesthetic.
 *
 *   T+2.5s  BANISHED
 *     - ShatteringNode + AshBurst unmount, freeing physics colliders and
 *       particle buffers.
 *     - Node's health flips to 'banished', then immediately removed from
 *       networkStore (also removes incident links).
 *     - Slash record removed from this store.
 *
 * The store exposes one external trigger (`triggerSlash`) and one internal
 * driver (`tick`) called once per frame from the Scene's useFrame loop.
 * Self-driving phases avoid scattering setTimeout calls and survive React
 * StrictMode double-mounting in dev.
 */

import { create } from 'zustand';
import type { Vector3Tuple } from 'three';
import { useNetworkStore } from './networkStore';

export type SlashPhaseId = 'DETECTION' | 'COLLAPSE' | 'BANISHED';

/** Timing of phase transitions, in seconds from triggerSlash. */
export const SLASH_TIMING = {
  /** Eyes flip + links go red. */
  detectionStart: 0.0,
  /** Voxels detach from instanced field; Rapier takes over; ash burst spawns. */
  collapseStart: 0.5,
  /** Cleanup — unmount physics bodies and particles, remove node. */
  banishedStart: 2.5,
} as const;

export interface SlashRecord {
  /** Node ID being slashed. */
  id: string;
  /** Current phase. */
  phase: SlashPhaseId;
  /** Time (in seconds, from clock.elapsedTime) when triggerSlash was called. */
  startTime: number;
  /** Frozen world-space position of the node at trigger time. */
  position: Vector3Tuple;
  /**
   * IDs of links that were errored as a result of this slash, so we can
   * track ownership during cleanup.
   */
  erroredLinkIds: string[];
}

interface SlashState {
  /** Active slash records, keyed by node id for O(1) lookup. */
  records: Map<string, SlashRecord>;

  /**
   * Trigger the slash sequence for a node. Idempotent — re-triggering an
   * already-slashed node is a no-op.
   */
  triggerSlash: (nodeId: string, clockSeconds: number) => void;

  /**
   * Queue a slash to be triggered at the next tick using the R3F clock.
   * Use this when calling from React event handlers (button clicks etc.)
   * since they don't have access to the canvas clock. The tick() driver
   * will dequeue and call triggerSlash with the correct clock time.
   */
  enqueueSlash: (nodeId: string) => void;

  /**
   * Advance phase state for all active records based on current clock time.
   * Called once per frame from Scene's MaterialAnimator (or a dedicated
   * driver). Mutates internal Map AND networkStore as phases transition.
   * Also drains the pending-trigger queue.
   */
  tick: (clockSeconds: number) => void;
}

export const useSlashStore = create<SlashState>((set, get) => {
  // Pending node IDs queued from React-side event handlers.
  // Kept outside the Zustand state because it's transient and we don't want
  // re-renders when items are added/removed.
  const pendingTriggers: string[] = [];

  return {
    records: new Map(),

    triggerSlash: (nodeId, clockSeconds) => {
      // Look up the node's current position from networkStore. If absent or
      // already slashed, bail.
      const netState = useNetworkStore.getState();
      const node = netState.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      if (node.health !== 'healthy') return; // already in progress
      if (get().records.has(nodeId)) return;

      const record: SlashRecord = {
        id: nodeId,
        phase: 'DETECTION',
        startTime: clockSeconds,
        position: [node.position[0], node.position[1], node.position[2]],
        erroredLinkIds: [],
      };

      // Side-effects in networkStore:
      //   1) Flip node health → detection (freezes it, swaps eye glyph).
      //   2) Mark every incident link as errored.
      netState.setNodeHealth(nodeId, 'detection');
      for (const link of netState.links) {
        if (link.sourceId === nodeId || link.targetId === nodeId) {
          netState.setLinkErrored(link.id, true);
          record.erroredLinkIds.push(link.id);
        }
      }

      // Insert record by cloning the Map (Zustand needs a new ref to notify).
      set((s) => {
        const next = new Map(s.records);
        next.set(nodeId, record);
        return { records: next };
      });
    },

    enqueueSlash: (nodeId) => {
      // Push to module-local queue; tick() will drain on next frame.
      // Idempotent guard: don't double-queue.
      if (!pendingTriggers.includes(nodeId)) pendingTriggers.push(nodeId);
    },

    tick: (clockSeconds) => {
      // Drain pending triggers first using the canonical clock.
      while (pendingTriggers.length > 0) {
        const nodeId = pendingTriggers.shift()!;
        get().triggerSlash(nodeId, clockSeconds);
      }

      const { records } = get();
      if (records.size === 0) return;

      const netState = useNetworkStore.getState();
      let mutated = false;
      const updated = new Map(records);

      for (const rec of records.values()) {
        const elapsed = clockSeconds - rec.startTime;

        if (rec.phase === 'DETECTION' && elapsed >= SLASH_TIMING.collapseStart) {
          // → COLLAPSE
          rec.phase = 'COLLAPSE';
          netState.setNodeHealth(rec.id, 'collapsing');
          updated.set(rec.id, { ...rec });
          mutated = true;
        } else if (rec.phase === 'COLLAPSE' && elapsed >= SLASH_TIMING.banishedStart) {
          // → BANISHED + cleanup
          rec.phase = 'BANISHED';
          // Mark banished briefly so any cleanup-aware components see it,
          // then remove the node entirely (also removes incident links).
          netState.setNodeHealth(rec.id, 'banished');
          netState.removeNode(rec.id);
          updated.delete(rec.id);
          mutated = true;
        }
      }

      if (mutated) set({ records: updated });
    },
  };
});

/**
 * Selector helpers — exported so components can subscribe to just the slice
 * they need (avoids re-rendering on every record update).
 */
export const selectIsSlashed = (nodeId: string) => (s: SlashState) =>
  s.records.has(nodeId);

export const selectSlashPhase = (nodeId: string) => (s: SlashState) =>
  s.records.get(nodeId)?.phase;

export const selectSlashRecord = (nodeId: string) => (s: SlashState) =>
  s.records.get(nodeId);
