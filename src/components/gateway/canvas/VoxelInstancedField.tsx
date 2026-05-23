'use client';

/**
 * VoxelInstancedField — the high-performance rendering core.
 *
 * Renders every voxel cube of every node in the scene using THREE.InstancedMesh.
 * For ~32 nodes × ~150 voxels each = ~5,000 cube instances, an InstancedMesh
 * gives us a single draw call per (type×kind) bucket instead of one per cube —
 * easily 60 FPS even on integrated GPUs.
 *
 * Architecture:
 *   - We allocate ONE InstancedMesh PER (NodeType × VoxelKind) combination.
 *     That's 5 types × 3 kinds = 15 instanced meshes. Each has its own
 *     material (e.g. genesis-body uses molten-glass shader, eco-glyph uses
 *     emissive green, all face kinds share a single ivory-white material).
 *   - Every frame, we walk the live node list and update per-instance matrices.
 *   - Voxel geometry is shared per-bucket: a single BoxGeometry.
 *
 * Per-frame work is O(total voxels) with zero allocations in the hot path —
 * all scratch objects (matrices, vectors, counter buffer) are pre-allocated
 * via useMemo and reused across frames.
 */

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useNetworkStore } from '@/src/store/networkStore';
import { NODE_TYPE_LIST } from '@/src/lib/gateway/constants/nodeTypes';
import { getVoxels, EXTRUSION_DEPTH, GRID_SIZE } from '@/src/lib/gateway/constants/shapes';
import type { NodeType } from '@/src/types/gateway';
import type { VoxelKind } from '@/src/lib/gateway/constants/shapes';
import { stepForceGraph, DEFAULT_PARAMS } from '@/src/lib/gateway/physics/forceGraph';
import { buildMaterial, getSlashedGlyphMaterial } from '@/src/lib/gateway/shaders/voxelMaterial';

/** Edge length of a single voxel in world units. */
const VOXEL_SIZE = 0.13;

/** Max instances per (type, kind) bucket. Generous — covers growth headroom. */
const MAX_INSTANCES_PER_BUCKET = 4096;

const VOXEL_KINDS: VoxelKind[] = ['body', 'face', 'glyph'];

/** Stable key for the shared red-glyph bucket used in DETECTION phase. */
const SLASHED_GLYPH_KEY = '__slashed__:glyph';

interface Bucket {
  type: NodeType;
  kind: VoxelKind;
  mesh: THREE.InstancedMesh;
  geom: THREE.BoxGeometry;
  material: THREE.Material;
  /** Stable key used to index `counters`. */
  key: string;
}

export function VoxelInstancedField() {
  // -------- Pre-allocated scratch (no per-frame GC) --------
  const scratch = useMemo(
    () => ({
      mat: new THREE.Matrix4(),
      baseMat: new THREE.Matrix4(),
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
      euler: new THREE.Euler(),
    }),
    [],
  );

  // -------- Build the 15 type-buckets + 1 shared slashed-glyph bucket --------
  const buckets = useMemo<Bucket[]>(() => {
    const list: Bucket[] = [];
    for (const type of NODE_TYPE_LIST) {
      for (const kind of VOXEL_KINDS) {
        const geom = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
        const material = buildMaterial(type, kind);
        const mesh = new THREE.InstancedMesh(
          geom,
          material,
          MAX_INSTANCES_PER_BUCKET,
        );
        mesh.count = 0;
        mesh.frustumCulled = false; // small scene; saves a culling pass
        list.push({ type, kind, mesh, geom, material, key: `${type}:${kind}` });
      }
    }
    // Extra bucket: shared red glyph for ALL types in DETECTION phase.
    // type is set to 'genesis' as a placeholder — only the key matters here.
    {
      const geom = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
      const material = getSlashedGlyphMaterial();
      const mesh = new THREE.InstancedMesh(
        geom,
        material,
        MAX_INSTANCES_PER_BUCKET,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      list.push({
        type: 'genesis',
        kind: 'glyph',
        mesh,
        geom,
        material,
        key: SLASHED_GLYPH_KEY,
      });
    }
    return list;
  }, []);

  // -------- Bucket lookup keyed by "type:kind" --------
  const bucketByKey = useMemo(() => {
    const m = new Map<string, Bucket>();
    for (const b of buckets) m.set(b.key, b);
    return m;
  }, [buckets]);

  // -------- Pre-allocated counters buffer (Int32Array, no allocations/frame) --------
  const counters = useMemo(() => new Int32Array(buckets.length), [buckets]);
  // Inverse map: bucket → counter index. Stable across renders.
  const bucketCounterIdx = useMemo(() => {
    const m = new Map<string, number>();
    buckets.forEach((b, i) => m.set(b.key, i));
    return m;
  }, [buckets]);

  // -------- Precompute static voxel templates per type (both eye states) --------
  const voxelTemplates = useMemo(() => {
    const healthy: Partial<Record<NodeType, ReturnType<typeof getVoxels>>> = {};
    const slashed: Partial<Record<NodeType, ReturnType<typeof getVoxels>>> = {};
    for (const type of NODE_TYPE_LIST) {
      healthy[type] = getVoxels(type, 'healthy');
      slashed[type] = getVoxels(type, 'slashed');
    }
    return {
      healthy: healthy as Record<NodeType, ReturnType<typeof getVoxels>>,
      slashed: slashed as Record<NodeType, ReturnType<typeof getVoxels>>,
    };
  }, []);

  useFrame((state, dt) => {
    const store = useNetworkStore.getState();

    // Decrement & apply the transient pulse, if any. We mutate the store
    // entry in place rather than calling setPulse() to avoid re-renders
    // every frame; only the final clear-to-null write goes through setPulse.
    let pulseInput: { origin: [number, number, number]; strength: number } | null = null;
    if (store.pulse) {
      store.pulse.remaining -= dt;
      if (store.pulse.remaining <= 0) {
        store.setPulse(null);
      } else {
        // Constant strength while alive — simple and visually punchy.
        pulseInput = {
          origin: store.pulse.origin,
          strength: store.pulse.strength,
        };
      }
    }

    // 1) Advance physics. Entropy is driven by timeline scrub: timelineT=1
    //    (present) → entropy=0, timelineT=0 (past) → entropy=1.
    const entropy = 1 - store.timelineT;
    stepForceGraph(
      store.nodes,
      store.links,
      dt,
      { ...DEFAULT_PARAMS, entropy },
      pulseInput,
    );

    // 2) Reset counters (Int32Array fill is one instruction per element).
    counters.fill(0);

    const elapsed = state.clock.elapsedTime;
    const { mat, baseMat, pos, quat, scale, euler } = scratch;

    // 3) Walk every visible node, emit one matrix per voxel into its bucket.
    //    - 'healthy'     → use healthy template, glyphs go to type-color bucket
    //    - 'detection'   → use slashed template, glyphs go to RED shared bucket,
    //                      node is frozen (no bob, no rotation drift)
    //    - 'collapsing'  → SKIP entirely (ShatteringNode owns the voxels)
    //    - 'banished'    → SKIP entirely (about to unmount)
    for (const node of store.nodes) {
      if (node.health === 'collapsing' || node.health === 'banished') continue;

      const isDetection = node.health === 'detection';
      const template = isDetection
        ? voxelTemplates.slashed[node.type]
        : voxelTemplates.healthy[node.type];

      // Per-node animation: gentle bob + slow rotation. `seed` desyncs siblings.
      // During DETECTION the node is frozen (no animation) — sells the "caught
      // in the act" beat before everything collapses.
      const bob = isDetection
        ? 0
        : Math.sin(elapsed * 0.8 + node.seed * Math.PI * 2) * 0.08;
      const rotY = isDetection
        ? node.seed * Math.PI * 2  // hold last orientation
        : elapsed * 0.12 + node.seed * Math.PI * 2;
      const rotX = isDetection
        ? 0
        : Math.sin(elapsed * 0.5 + node.seed * 3.0) * 0.06;

      pos.set(node.position[0], node.position[1] + bob, node.position[2]);
      euler.set(rotX, rotY, 0);
      quat.setFromEuler(euler);
      scale.set(1, 1, 1);

      // Per-node base transform. Voxel offsets are applied in this frame.
      baseMat.compose(pos, quat, scale);

      for (const v of template) {
        // Route glyph cubes to the red shared bucket during detection.
        const bucketKey =
          isDetection && v.kind === 'glyph'
            ? SLASHED_GLYPH_KEY
            : `${node.type}:${v.kind}`;
        const bucket = bucketByKey.get(bucketKey);
        if (!bucket) continue;
        const cIdx = bucketCounterIdx.get(bucket.key)!;
        const instIdx = counters[cIdx];
        if (instIdx >= MAX_INSTANCES_PER_BUCKET) continue;

        // Voxel local offset (grid → world units).
        const ws = VOXEL_SIZE * node.scale;
        pos.set(v.gx * ws, v.gy * ws, v.gz * ws);
        // Push through the node's base transform to get the world position.
        pos.applyMatrix4(baseMat);

        // Final per-voxel matrix: world position + node rotation + unit scale.
        mat.compose(pos, quat, scale);
        bucket.mesh.setMatrixAt(instIdx, mat);
        counters[cIdx] = instIdx + 1;
      }
    }

    // 4) Commit counts and flag GPU upload.
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      b.mesh.count = counters[i];
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {buckets.map((b) => (
        <primitive key={b.key} object={b.mesh} />
      ))}
    </group>
  );
}

// Expose constants for use by sibling components (particle emitters that
// need to know the visual size of a node).
export const VOXEL_FIELD_CONSTANTS = {
  VOXEL_SIZE,
  GRID_SIZE,
  EXTRUSION_DEPTH,
  approximateNodeRadius: (nodeScale: number) =>
    (GRID_SIZE * VOXEL_SIZE * nodeScale) / 2,
};
