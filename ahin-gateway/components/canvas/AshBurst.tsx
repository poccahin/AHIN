'use client';

/**
 * AshBurst — the "burning digital assets" emitter.
 *
 * Spawns instantly on mount at a given world position, emits ~300 sharp
 * angular ash/ember particles in an upward-biased explosion cone, then
 * decays over ~2 seconds as particles cool from amber → dark grey and
 * fall under gravity.
 *
 * Visual target (per brief):
 *   - Sharp ember chips, not soft round dots
 *   - Dark amber and charcoal grey palette, not bright fireworks
 *   - Strong upward burst, then heavy fall — "money on fire" feel
 *
 * Implementation:
 *   - Single InstancedMesh of small jagged "chip" geometry (a flattened
 *     tetrahedron — three sharp faces, very low-poly).
 *   - Per-instance state in Float32Arrays: position, velocity, life,
 *     spinAxis, spinRate.
 *   - Color is shifted on the GPU via per-instance color attribute
 *     (red-amber when hot, fading to charcoal).
 *   - Single useFrame integrator, one needsUpdate flag per frame.
 *
 * Lifetime is bounded — the component is mounted by SlashingSequence for
 * the duration of COLLAPSE (~2s), then unmounted, which disposes geometry
 * and material.
 */

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vector3Tuple } from 'three';

interface AshBurstProps {
  origin: Vector3Tuple;
  /** Total particles to spawn at t=0. */
  count?: number;
  /** Per-particle lifetime in seconds. */
  maxLife?: number;
  /** Maximum initial upward burst velocity. */
  speedMax?: number;
}

/** Color stops: hot amber → cooled charcoal. Sampled by particle age. */
const HOT_COLOR = new THREE.Color(0xff8030);
const MID_COLOR = new THREE.Color(0x8a4020);
const COOL_COLOR = new THREE.Color(0x1c1816);

/** Build a small jagged "chip" geometry — three-sided ember. */
function buildChipGeometry(): THREE.BufferGeometry {
  // A flattened triangular bipyramid — six faces, sharp edges, ~6 vertices.
  const geom = new THREE.TetrahedronGeometry(0.05, 0);
  // Squash slightly along one axis to make it shard-like rather than ball-like.
  geom.scale(1.0, 0.45, 1.0);
  return geom;
}

export function AshBurst({
  origin,
  count = 280,
  maxLife = 2.2,
  speedMax = 9.0,
}: AshBurstProps) {
  // -------- Allocate buffers exactly once --------
  const buffers = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lives = new Float32Array(count);
    const maxLives = new Float32Array(count);
    const spinAxis = new Float32Array(count * 3);
    const spinRate = new Float32Array(count);
    const colorOut = new Float32Array(count * 3);

    // Seed all particles at the origin with explosive velocity.
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = origin[0];
      positions[i3 + 1] = origin[1];
      positions[i3 + 2] = origin[2];

      // Upward-biased hemisphere: random direction, but bias Y upward.
      // Use cosine-weighted hemisphere sample → most particles go up & outward.
      const phi = Math.acos(Math.random() * 0.8 + 0.05); // 0..~84°, weighted up
      const theta = Math.random() * Math.PI * 2;
      const dx = Math.sin(phi) * Math.cos(theta);
      const dy = Math.cos(phi); // mostly positive
      const dz = Math.sin(phi) * Math.sin(theta);

      // Speed distribution: power law — most particles slow, a few fast.
      const sp = speedMax * (0.25 + Math.pow(Math.random(), 2) * 0.75);

      velocities[i3] = dx * sp;
      velocities[i3 + 1] = dy * sp + 1.5; // extra upward kick
      velocities[i3 + 2] = dz * sp;

      lives[i] = maxLives[i] = maxLife * (0.55 + Math.random() * 0.45);

      // Random spin axis (unit) and rate.
      const ax = Math.random() - 0.5;
      const ay = Math.random() - 0.5;
      const az = Math.random() - 0.5;
      const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      spinAxis[i3] = ax / al;
      spinAxis[i3 + 1] = ay / al;
      spinAxis[i3 + 2] = az / al;
      spinRate[i] = (Math.random() - 0.5) * 12;

      colorOut[i3] = HOT_COLOR.r;
      colorOut[i3 + 1] = HOT_COLOR.g;
      colorOut[i3 + 2] = HOT_COLOR.b;
    }

    return { positions, velocities, lives, maxLives, spinAxis, spinRate, colorOut };
  }, [origin, count, maxLife, speedMax]);

  // -------- Geometry & material --------
  const geom = useMemo(buildChipGeometry, []);

  const material = useMemo(() => {
    // Standard physical with vertex colors → each chip can carry its own
    // current color. emissive keeps the hot ones glowing in dark scenes.
    const m = new THREE.MeshStandardMaterial({
      vertexColors: false, // we drive per-INSTANCE color via instanceColor attr
      color: 0xffffff,     // tinted entirely by instance colors
      emissive: 0xff6020,
      emissiveIntensity: 0.6,
      roughness: 0.65,
      metalness: 0.05,
      transparent: false,
      depthWrite: true,
    });
    return m;
  }, []);

  // -------- The InstancedMesh --------
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Initialize instanceMatrix + instanceColor when the mesh mounts.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const tmp = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      tmp.position.set(
        buffers.positions[i3],
        buffers.positions[i3 + 1],
        buffers.positions[i3 + 2],
      );
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(0.5 + Math.random() * 1.1);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      mesh.setColorAt(i, HOT_COLOR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [buffers, count]);

  // Pre-allocated scratch (avoid per-frame GC).
  const scratch = useMemo(
    () => ({
      tmpObj: new THREE.Object3D(),
      tmpColor: new THREE.Color(),
      tmpQuat: new THREE.Quaternion(),
      tmpAxis: new THREE.Vector3(),
      currentQuats: new Float32Array(count * 4), // x,y,z,w per particle
      didInitQuat: false,
    }),
    [count],
  );

  // Init quaternions on first frame to identity.
  useEffect(() => {
    if (scratch.didInitQuat) return;
    for (let i = 0; i < count; i++) {
      const i4 = i * 4;
      scratch.currentQuats[i4] = 0;
      scratch.currentQuats[i4 + 1] = 0;
      scratch.currentQuats[i4 + 2] = 0;
      scratch.currentQuats[i4 + 3] = 1;
    }
    scratch.didInitQuat = true;
  }, [scratch, count]);

  useFrame((_, dtRaw) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dt = Math.min(dtRaw, 1 / 30);

    const {
      positions,
      velocities,
      lives,
      maxLives,
      spinAxis,
      spinRate,
    } = buffers;
    const { tmpObj, tmpColor, tmpQuat, tmpAxis, currentQuats } = scratch;

    // Gravity for ash (weaker than world gravity — embers float a bit).
    const GRAV = -14;
    // Air drag.
    const DRAG = 0.97;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const i4 = i * 4;

      // Decay life.
      const life = (lives[i] -= dt);
      if (life <= 0) {
        // Hide expired particles by setting scale to 0.
        tmpObj.position.set(0, -10000, 0);
        tmpObj.scale.setScalar(0);
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.updateMatrix();
        mesh.setMatrixAt(i, tmpObj.matrix);
        continue;
      }

      // Integrate velocity & position.
      velocities[i3 + 1] += GRAV * dt;
      velocities[i3] *= DRAG;
      velocities[i3 + 1] *= DRAG;
      velocities[i3 + 2] *= DRAG;

      positions[i3]     += velocities[i3]     * dt;
      positions[i3 + 1] += velocities[i3 + 1] * dt;
      positions[i3 + 2] += velocities[i3 + 2] * dt;

      // Tumble: rotate quaternion by spinAxis * spinRate * dt.
      const angle = spinRate[i] * dt;
      tmpAxis.set(spinAxis[i3], spinAxis[i3 + 1], spinAxis[i3 + 2]);
      tmpQuat.setFromAxisAngle(tmpAxis, angle);
      // Multiply current quaternion by delta.
      const cx = currentQuats[i4];
      const cy = currentQuats[i4 + 1];
      const cz = currentQuats[i4 + 2];
      const cw = currentQuats[i4 + 3];
      const dx = tmpQuat.x;
      const dy = tmpQuat.y;
      const dz = tmpQuat.z;
      const dw = tmpQuat.w;
      const nx = dw * cx + dx * cw + dy * cz - dz * cy;
      const ny = dw * cy - dx * cz + dy * cw + dz * cx;
      const nz = dw * cz + dx * cy - dy * cx + dz * cw;
      const nw = dw * cw - dx * cx - dy * cy - dz * cz;
      currentQuats[i4] = nx;
      currentQuats[i4 + 1] = ny;
      currentQuats[i4 + 2] = nz;
      currentQuats[i4 + 3] = nw;

      // Color: interpolate hot → mid → cool by age.
      const age01 = 1 - life / maxLives[i]; // 0..1
      if (age01 < 0.4) {
        tmpColor.copy(HOT_COLOR).lerp(MID_COLOR, age01 / 0.4);
      } else {
        tmpColor.copy(MID_COLOR).lerp(COOL_COLOR, (age01 - 0.4) / 0.6);
      }
      mesh.setColorAt(i, tmpColor);

      // Compose matrix from current state.
      tmpObj.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
      tmpObj.quaternion.set(nx, ny, nz, nw);
      // Shrink slightly as particle ages.
      const ageScale = Math.max(0.2, 1 - age01 * 0.6);
      tmpObj.scale.setScalar(0.5 + 0.6 * ageScale);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      geom.dispose();
      material.dispose();
    };
  }, [geom, material]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, material, count]}
      frustumCulled={false}
    />
  );
}
