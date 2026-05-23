'use client';

/**
 * ShatteringNode — physical disintegration of a single slashed node.
 *
 * When a node enters the COLLAPSE phase, the VoxelInstancedField stops drawing
 * it and one of these components is mounted at its frozen world position. We
 * walk the node-type's voxel mask (the same 16×16×4 occupancy data used by the
 * instanced field) and spawn ONE Rapier <RigidBody> per voxel, each with a
 * tiny <mesh> showing the same colored cube. We apply a brief radial-outward
 * impulse at spawn so the silhouette explodes outward before gravity catches
 * up and the chunks fall into the void.
 *
 * Why per-voxel rigid bodies?
 *   - We get correct visual disintegration without writing a custom shader
 *     for fragment scattering.
 *   - The pieces collide with each other and with the (invisible) ground
 *     plane (added separately in Scene.tsx), producing a satisfying tumble.
 *
 * Cost:
 *   - ~150 voxels per node → ~150 RigidBody objects per shatter. Rapier
 *     handles this trivially.
 *   - Component unmounts when the slashStore advances past COLLAPSE, which
 *     fully releases the bodies to GC.
 *
 * Materials:
 *   - We reuse the SAME MeshPhysicalMaterial instances that the instanced
 *     field uses (via `buildMaterial`). This keeps the visual continuity
 *     ("the cubes that fall are the cubes that were just here").
 *   - To keep draw-call count manageable when many ShatteringNodes are
 *     active simultaneously, the cubes are NOT instanced here — each is a
 *     standalone mesh. This is the price of independent physics. Future
 *     optimization: a "shadow instanced field" that mirrors Rapier body
 *     positions every frame and renders via InstancedMesh.
 */

import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody, type RapierRigidBody } from '@react-three/rapier';
import type { AhinNode } from '@/types/network';
import { getVoxels } from '@/lib/constants/shapes';
import { buildMaterial } from '@/lib/shaders/voxelMaterial';

const VOXEL_SIZE = 0.13;

/** Maximum outward burst speed (m/s) at spawn. */
const BURST_SPEED_MAX = 6.5;
const BURST_SPEED_MIN = 2.5;
/** Vertical bias — adds upward lift so the silhouette "puffs up" briefly. */
const BURST_UP_BIAS = 1.4;
/** Angular impulse spread — gives each cube its own tumble. */
const ANGULAR_SPREAD = 8;
/** Per-voxel mass (kg). Small but non-zero so impulses feel snappy. */
const VOXEL_MASS = 0.04;

/** Shared geometry — one BoxGeometry reused by every cube in every shatter. */
let _sharedBoxGeom: THREE.BoxGeometry | null = null;
function getSharedBoxGeom(): THREE.BoxGeometry {
  if (!_sharedBoxGeom) {
    _sharedBoxGeom = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
  }
  return _sharedBoxGeom;
}

interface ShatteringNodeProps {
  node: AhinNode;
}

/**
 * One ShatteringNode renders the disintegration of a single slashed node.
 *
 * Props.node is the frozen snapshot taken at COLLAPSE time. We don't read
 * the live store here — the node may already be removed from networkStore
 * by the time COLLAPSE → BANISHED triggers cleanup.
 */
export function ShatteringNode({ node }: ShatteringNodeProps) {
  // Build the voxel list once. Use 'slashed' eye state so the falling face
  // shows -- glyphs, consistent with what we just saw in DETECTION.
  const voxels = useMemo(() => getVoxels(node.type, 'slashed'), [node.type]);

  // Resolve the three material families for this node type. We keep glyph
  // cubes red (using the slashed-glyph material would be more consistent,
  // but reusing the type's normal glyph material gives a tiny color cue —
  // we go with the dramatic red instead via the slashed-glyph material).
  // For simplicity here we reuse the type-color glyph material; the
  // VoxelInstancedField already established the "red --" beat during
  // DETECTION. Once falling, the chunks read as "the body of the creature"
  // regardless of glyph color.
  const bodyMat = useMemo(() => buildMaterial(node.type, 'body'), [node.type]);
  const faceMat = useMemo(() => buildMaterial(node.type, 'face'), [node.type]);
  const glyphMat = useMemo(() => buildMaterial(node.type, 'glyph'), [node.type]);

  const geom = useMemo(() => getSharedBoxGeom(), []);

  // Per-voxel ref array for applying initial burst impulses after mount.
  // Rapier doesn't process impulses until the body has been registered with
  // the world, which happens after the first render — so we run impulses in
  // a useEffect.
  const bodyRefs = useRef<Array<RapierRigidBody | null>>([]);
  bodyRefs.current = new Array(voxels.length).fill(null);

  useEffect(() => {
    // Apply outward burst impulses one tick after mount.
    for (let i = 0; i < voxels.length; i++) {
      const body = bodyRefs.current[i];
      if (!body) continue;
      const v = voxels[i];

      // Direction: from node origin outward through this voxel's local pos.
      // Cubes near the silhouette edge fly faster than core cubes.
      const lx = v.gx;
      const ly = v.gy;
      const lz = v.gz;
      const dist = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
      const ux = lx / dist;
      const uy = ly / dist;
      const uz = lz / dist;

      // Speed scales with radial position (edges burst harder).
      const radialNorm = Math.min(dist / 8, 1);
      const speed =
        BURST_SPEED_MIN +
        (BURST_SPEED_MAX - BURST_SPEED_MIN) * (0.4 + 0.6 * radialNorm);

      // Add jitter so it doesn't look perfectly radial.
      const jitterX = (Math.random() - 0.5) * 0.8;
      const jitterY = (Math.random() - 0.5) * 0.4;
      const jitterZ = (Math.random() - 0.5) * 0.8;

      const ix = ux * speed + jitterX;
      const iy = uy * speed + BURST_UP_BIAS + jitterY;
      const iz = uz * speed + jitterZ;

      // Apply as linear velocity (instant, not an impulse that integrates).
      body.setLinvel({ x: ix, y: iy, z: iz }, true);

      // Random angular velocity — each chunk tumbles independently.
      body.setAngvel(
        {
          x: (Math.random() - 0.5) * ANGULAR_SPREAD,
          y: (Math.random() - 0.5) * ANGULAR_SPREAD,
          z: (Math.random() - 0.5) * ANGULAR_SPREAD,
        },
        true,
      );
    }
    // Intentionally only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // World-space starting position of each voxel = node.position + grid offset
  // (with rotation baked to identity since DETECTION froze the node already).
  const nodePos = node.position;
  const nodeScale = node.scale;

  return (
    <group>
      {voxels.map((v, i) => {
        const wx = nodePos[0] + v.gx * VOXEL_SIZE * nodeScale;
        const wy = nodePos[1] + v.gy * VOXEL_SIZE * nodeScale;
        const wz = nodePos[2] + v.gz * VOXEL_SIZE * nodeScale;

        const mat =
          v.kind === 'body' ? bodyMat : v.kind === 'face' ? faceMat : glyphMat;

        return (
          <RigidBody
            key={i}
            ref={(r) => {
              bodyRefs.current[i] = r;
            }}
            position={[wx, wy, wz]}
            colliders="cuboid"
            mass={VOXEL_MASS}
            linearDamping={0.4}
            angularDamping={0.3}
            restitution={0.15}
            friction={0.55}
            // Don't collide with other shattering nodes' debris — too noisy.
            // Each shatter gets its own collision group via the membership/filter
            // pattern: members[0]=group bit, filter[0]=which groups to interact with.
            // For Phase 2 we let them collide with the ground only (group 0x0001)
            // and not each other.
            collisionGroups={0x00010001}
          >
            <mesh geometry={geom} material={mat} castShadow={false} receiveShadow={false} />
          </RigidBody>
        );
      })}
    </group>
  );
}
