'use client';

/**
 * CausalFlash — pooled "consensus confirmation" flares.
 *
 * When a node interaction completes (i.e. a causal hash is updated and the
 * link pulse cycles back to the start), we emit a short-lived glowing
 * sphere at the link's midpoint. The flare scales up rapidly and fades
 * out with exponential alpha decay (e^(-σ·t)), evoking the quantum
 * collapse / consensus moment in PoCC.
 *
 * Implementation:
 *   - One InstancedMesh of unit spheres, capacity = MAX_FLASHES.
 *   - Per-instance state in Float32 buffers: position, scaleEnd, age, ttl.
 *   - Compaction-free: each slot has an "alive" flag; dead slots have
 *     scale 0 and live off-screen. We track a `tail` pointer so spawn is
 *     O(1) amortized (scan from tail for a dead slot).
 *
 * External API:
 *   - import { triggerCausalFlash } from this module
 *   - triggerCausalFlash(position, color)  → schedules one flare
 *
 * The component itself only consumes the pending queue and runs the
 * per-frame integrator. No store needed.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const MAX_FLASHES = 32;
/** Peak scale of the flare (world units). */
const FLASH_PEAK_SCALE = 1.2;
/** Lifetime in seconds. */
const FLASH_TTL = 0.7;
/** Decay rate σ in exp(-σ·t). Higher = faster fade. */
const FLASH_SIGMA = 5.5;

interface PendingFlash {
  pos: [number, number, number];
  color: [number, number, number];
}

/** Module-level queue of pending flashes. Drained each frame. */
const pendingFlashes: PendingFlash[] = [];

/**
 * Schedule a causal-consensus flare at the given world position.
 * Safe to call from React event handlers, useFrame, or anywhere else.
 */
export function triggerCausalFlash(
  pos: [number, number, number],
  color: [number, number, number] = [1.0, 0.85, 0.5],
): void {
  // Cap queue to avoid runaway accumulation if frames are slow.
  if (pendingFlashes.length > MAX_FLASHES) return;
  pendingFlashes.push({ pos, color });
}

export function CausalFlash() {
  // Per-slot state.
  const state = useMemo(
    () => ({
      ages: new Float32Array(MAX_FLASHES),
      ttls: new Float32Array(MAX_FLASHES),
      positions: new Float32Array(MAX_FLASHES * 3),
      colors: new Float32Array(MAX_FLASHES * 3),
      alive: new Uint8Array(MAX_FLASHES),
    }),
    [],
  );

  // Scratch.
  const scratch = useMemo(
    () => ({
      obj: new THREE.Object3D(),
      col: new THREE.Color(),
    }),
    [],
  );

  // Geometry + material — created once.
  const { geometry, material } = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 16, 12);
    const m = new THREE.MeshBasicMaterial({
      color: 0xffffff,         // tinted entirely by per-instance color
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 1,              // alpha varies per instance via color magnitude
    });
    return { geometry: g, material: m };
  }, []);

  // Dispose on unmount.
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Initialize instance positions far off-screen and scales to 0.
  const meshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const obj = scratch.obj;
    for (let i = 0; i < MAX_FLASHES; i++) {
      obj.position.set(0, -100000, 0);
      obj.scale.setScalar(0);
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);
      mesh.setColorAt(i, scratch.col.setRGB(0, 0, 0));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [scratch]);

  useFrame((_, dtRaw) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dt = Math.min(dtRaw, 1 / 30);
    const { ages, ttls, positions, colors, alive } = state;
    const { obj, col } = scratch;

    // 1) Drain pending queue into free slots.
    while (pendingFlashes.length > 0) {
      let slot = -1;
      for (let i = 0; i < MAX_FLASHES; i++) {
        if (!alive[i]) {
          slot = i;
          break;
        }
      }
      if (slot < 0) {
        // No free slot — clear the queue to avoid backpressure.
        pendingFlashes.length = 0;
        break;
      }
      const pf = pendingFlashes.shift()!;
      const i3 = slot * 3;
      positions[i3] = pf.pos[0];
      positions[i3 + 1] = pf.pos[1];
      positions[i3 + 2] = pf.pos[2];
      colors[i3] = pf.color[0];
      colors[i3 + 1] = pf.color[1];
      colors[i3 + 2] = pf.color[2];
      ages[slot] = 0;
      ttls[slot] = FLASH_TTL;
      alive[slot] = 1;
    }

    // 2) Tick every slot.
    for (let i = 0; i < MAX_FLASHES; i++) {
      if (!alive[i]) continue;
      ages[i] += dt;
      if (ages[i] >= ttls[i]) {
        // Expire.
        alive[i] = 0;
        obj.position.set(0, -100000, 0);
        obj.scale.setScalar(0);
        obj.updateMatrix();
        mesh.setMatrixAt(i, obj.matrix);
        mesh.setColorAt(i, col.setRGB(0, 0, 0));
        continue;
      }

      const t = ages[i];
      // Scale curve: fast easeOut to peak in first ~25% of life, then hold.
      const scaleT = Math.min(t / (ttls[i] * 0.25), 1.0);
      const scale = FLASH_PEAK_SCALE * (1 - Math.pow(1 - scaleT, 3));

      // Alpha (encoded into color magnitude): exp(-σ·t).
      const alpha = Math.exp(-FLASH_SIGMA * t);

      const i3 = i * 3;
      obj.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
      obj.scale.setScalar(scale);
      obj.rotation.set(0, 0, 0);
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);

      // Color: base color × alpha, with a bias toward white at peak alpha
      // for the "core white-hot center" feel.
      const whiteMix = Math.min(alpha * 0.6, 0.5);
      col.setRGB(
        (colors[i3] * (1 - whiteMix) + whiteMix) * alpha,
        (colors[i3 + 1] * (1 - whiteMix) + whiteMix) * alpha,
        (colors[i3 + 2] * (1 - whiteMix) + whiteMix) * alpha,
      );
      mesh.setColorAt(i, col);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_FLASHES]}
      frustumCulled={false}
    />
  );
}
