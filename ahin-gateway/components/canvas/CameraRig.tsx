'use client';

/**
 * CameraRig — cinematic camera control for the boardroom presentation.
 *
 * Responsibilities:
 *   1. OrbitControls with luxurious damping for user interaction.
 *   2. Idle ambient drift on the controls' look-at target — gives the
 *      scene a subtle sense of life when the user isn't touching anything.
 *   3. Proximity-aware shake: when a node enters COLLAPSE phase, compute
 *      its distance to the camera and apply a shake whose intensity is
 *      inversely proportional to distance. Shake decays exponentially.
 *
 * Implementation note on shake: applying a position offset directly to
 * the camera would fight OrbitControls (which writes to camera.position on
 * every frame). Setting `useFrame` to a non-default priority would disable
 * R3F's auto-render. We avoid both problems by applying the shake to the
 * OrbitControls TARGET instead: jittering the look-at point shakes the
 * camera's apparent orientation, which reads as a screen-space rumble.
 * For radial proximity rumble, we additionally jitter the controls'
 * camera position via `object.position` directly — OrbitControls re-uses
 * this each frame, so our offset persists until cleared.
 *
 * Both effects are layered as small offsets on top of the orbit math
 * controls.update() resolves, so the rumble reads correctly regardless of
 * user-orbited yaw/pitch.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useSlashStore } from '@/lib/state/slashStore';

/** Drift amplitudes (world units) and frequencies (Hz). */
const DRIFT_AMP = new THREE.Vector3(0.45, 0.3, 0.25);
const DRIFT_FREQ = new THREE.Vector3(0.07, 0.09, 0.05);

/** Shake decay rate σ in exp(-σ·t). Higher = faster decay. */
const SHAKE_DECAY = 4.5;
/** Base shake amplitude at distance ≈ 12 units. Falls off with 1/distance^0.9. */
const SHAKE_BASE_AMPLITUDE = 0.55;
/** Hard cap on shake amplitude regardless of distance (prevents NaN at d→0). */
const SHAKE_MAX = 0.6;

/** Active shake events (one per recent COLLAPSE). */
interface ShakeEvent {
  /** Time elapsed since this shake started (seconds). */
  age: number;
  /** Effective amplitude at t=0 (already proximity-scaled). */
  amplitude: number;
  /** Per-axis frequency for the shake — randomized per event for variety. */
  freq: [number, number, number];
  /** Per-axis phase offset. */
  phase: [number, number, number];
}

export function CameraRig() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const shakes = useRef<ShakeEvent[]>([]);
  const triggeredIds = useRef<Set<string>>(new Set());

  const scratch = useMemo(
    () => ({
      driftTarget: new THREE.Vector3(),
      shakeOffset: new THREE.Vector3(),
      tmpDir: new THREE.Vector3(),
      // The "ideal" target — center of network. Drift is layered on top.
      baseTarget: new THREE.Vector3(0, 0, 0),
    }),
    [],
  );

  // Subscribe to slashStore for shake triggers. We use a plain subscriber
  // (not useSyncExternalStore) so this component doesn't re-render on
  // every record change — only on phase transitions we care about.
  useEffect(() => {
    const unsubscribe = useSlashStore.subscribe((s) => {
      for (const rec of s.records.values()) {
        if (rec.phase !== 'COLLAPSE') continue;
        if (triggeredIds.current.has(rec.id)) continue;
        triggeredIds.current.add(rec.id);

        // Proximity-scaled amplitude: closer slashes = harder rumble.
        scratch.tmpDir.set(rec.position[0], rec.position[1], rec.position[2]);
        const dist = Math.max(scratch.tmpDir.distanceTo(camera.position), 1);
        const amplitude = Math.min(
          SHAKE_BASE_AMPLITUDE / Math.pow(dist / 12, 0.9),
          SHAKE_MAX,
        );

        shakes.current.push({
          age: 0,
          amplitude,
          freq: [
            38 + Math.random() * 12,
            42 + Math.random() * 12,
            46 + Math.random() * 12,
          ],
          phase: [
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
          ],
        });
      }
      // Sweep triggeredIds — drop entries whose records no longer exist.
      const liveIds = new Set([...s.records.keys()]);
      for (const id of triggeredIds.current) {
        if (!liveIds.has(id)) triggeredIds.current.delete(id);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [camera, scratch]);

  // Default-priority useFrame (priority 0) — runs alongside OrbitControls
  // without disabling R3F's auto-render. We apply drift to the controls'
  // TARGET (which OrbitControls reads on its own update) and shake by
  // jittering both the target and the camera position directly. Because
  // OrbitControls.update() runs in response to internal pointer events
  // (not in our useFrame), our writes to camera.position persist correctly
  // until the next user interaction.
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const controls = controlsRef.current;

    // 1) Ambient Lissajous drift on the look-at target.
    scratch.driftTarget
      .copy(scratch.baseTarget)
      .add(
        new THREE.Vector3(
          Math.sin(t * DRIFT_FREQ.x * Math.PI * 2) * DRIFT_AMP.x,
          Math.cos(t * DRIFT_FREQ.y * Math.PI * 2 + 0.7) * DRIFT_AMP.y,
          Math.sin(t * DRIFT_FREQ.z * Math.PI * 2 + 1.4) * DRIFT_AMP.z,
        ),
      );

    // 2) Compute shake offset (sum across active events).
    scratch.shakeOffset.set(0, 0, 0);
    let writeIdx = 0;
    for (let i = 0; i < shakes.current.length; i++) {
      const sh = shakes.current[i];
      sh.age += dt;
      const env = Math.exp(-SHAKE_DECAY * sh.age);
      if (env < 0.005) continue;

      const k = sh.amplitude * env;
      scratch.shakeOffset.x += Math.sin(t * sh.freq[0] + sh.phase[0]) * k;
      scratch.shakeOffset.y += Math.sin(t * sh.freq[1] + sh.phase[1]) * k;
      scratch.shakeOffset.z += Math.sin(t * sh.freq[2] + sh.phase[2]) * k;

      if (writeIdx !== i) shakes.current[writeIdx] = sh;
      writeIdx++;
    }
    shakes.current.length = writeIdx;

    if (controls) {
      // Smooth-lerp the controls' target toward the drift target. Gives
      // the scene a slow living-scene feel even when idle.
      controls.target.lerp(scratch.driftTarget, 0.04);

      // Camera shake: OrbitControls (which ran at priority -1, just
      // before us) already re-resolved camera.position from the orbit
      // math, so we don't need to undo last frame's shake — we just
      // additively apply this frame's. The offset is non-persistent:
      // next frame's controls.update() overwrites cleanly.
      camera.position.add(scratch.shakeOffset);
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableZoom={true}
      enablePan={false}
      enableDamping={true}
      dampingFactor={0.05}
      maxDistance={40}
      minDistance={12}
      // Restrict pitch slightly so the scene never inverts.
      minPolarAngle={Math.PI * 0.18}
      maxPolarAngle={Math.PI * 0.82}
      makeDefault
      domElement={gl.domElement}
    />
  );
}
