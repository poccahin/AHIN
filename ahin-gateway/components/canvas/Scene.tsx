'use client';

/**
 * Scene — the 3D dark vacuum environment.
 *
 * Responsibilities:
 *   - Configure renderer (tone mapping, color space, pixel ratio)
 *   - Set up the camera and OrbitControls (subtle, drift-only)
 *   - Provide ambient + key + rim lighting tuned for the dark backdrop
 *   - Mount postprocessing (bloom is the single most important effect for
 *     the "premium luminous" look — without it, emissive materials look flat)
 *   - Mount the voxel field, particle field, and (Phase 2+) links/slashing
 *
 * Background: deep near-black with a subtle radial gradient implemented as
 * a backside-rendered IcosahedronGeometry shell, similar to the boardroom
 * mockup's misty atmosphere.
 */

import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import { VoxelInstancedField } from './VoxelInstancedField';
import { ParticleField } from './Particles/ParticleField';
import { Links } from './Links';
import { SlashingSequence } from './SlashingSequence';
import { CausalFlash } from './CausalFlash';
import { CausalFlashDriver } from './CausalFlashDriver';
import { CameraRig } from './CameraRig';
import { updateMaterialAnimations } from '@/lib/shaders/voxelMaterial';
import { BACKGROUND_COLOR } from '@/lib/constants/nodeTypes';
import { useSlashStore } from '@/lib/state/slashStore';
import { useNetworkStore } from '@/lib/state/networkStore';

/** Drives material emissive pulses each frame. Mounted inside Canvas. */
function MaterialAnimator() {
  useFrame(({ clock }) => {
    updateMaterialAnimations(clock.elapsedTime);
  });
  return null;
}

/** Atmospheric backdrop — a giant inverted sphere with a vertical gradient. */
function AtmosphereBackdrop() {
  const ref = useRef<THREE.Mesh>(null);
  return (
    <mesh ref={ref} scale={70}>
      <icosahedronGeometry args={[1, 4]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={{
          topColor: { value: new THREE.Color(0x0c0f18) },
          bottomColor: { value: new THREE.Color(0x05060a) },
          highlightColor: { value: new THREE.Color(0x1a1530) },
        }}
        vertexShader={/* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          uniform vec3 highlightColor;
          varying vec3 vPos;
          void main() {
            float h = normalize(vPos).y * 0.5 + 0.5;
            vec3 col = mix(bottomColor, topColor, smoothstep(0.0, 1.0, h));
            // Subtle horizontal violet highlight near the equator.
            float band = 1.0 - abs(normalize(vPos).y) * 2.2;
            col = mix(col, highlightColor, max(band, 0.0) * 0.3);
            gl_FragColor = vec4(col, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/**
 * Invisible ground plane — well below the action so chunks fall out of
 * frame before they land. The collider exists so Rapier eventually deactivates
 * the bodies (otherwise they sleep when they slow to rest), but the visual
 * effect is "the slashed node tumbles into the void."
 */
function GroundFloor() {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, -25, 0]}>
      <CuboidCollider args={[60, 0.5, 60]} />
    </RigidBody>
  );
}

/** All scene contents — separated so it can mount inside <Canvas>. */
function SceneContents() {
  return (
    <>
      <color attach="background" args={[`#${BACKGROUND_COLOR.toString(16).padStart(6, '0')}`]} />
      <AtmosphereBackdrop />

      {/* Lighting rig — three-point with cool/warm contrast. */}
      <ambientLight intensity={0.15} color="#aab3cc" />

      {/* Key: cool, from above-front. */}
      <directionalLight
        position={[8, 12, 8]}
        intensity={0.9}
        color="#dde6ff"
      />

      {/* Fill: warmer, from below-left. */}
      <directionalLight
        position={[-10, -4, 6]}
        intensity={0.4}
        color="#ffd9b8"
      />

      {/* Rim/back: violet, behind the action — gives subjects a luminous edge. */}
      <pointLight
        position={[0, 0, -12]}
        intensity={3.0}
        distance={40}
        decay={1.5}
        color="#a67bff"
      />

      {/* Subtle key warm point near the origin so Genesis nodes glow extra. */}
      <pointLight
        position={[0, 0, 4]}
        intensity={1.0}
        distance={20}
        decay={2}
        color="#ff8a4c"
      />

      <CameraRig />
      <MaterialAnimator />
      <TestSlashBinding />

      {/* Live scene contents. Physics is required for ShatteringNode +
          GroundFloor to register their rigid bodies. Non-RigidBody children
          (instanced field, particles, links) pass through with zero cost. */}
      <Physics gravity={[0, -20, 0]} timeStep={1 / 60}>
        <GroundFloor />
        <Suspense fallback={null}>
          <VoxelInstancedField />
          <ParticleField />
          <Links />
          <CausalFlash />
          <CausalFlashDriver />
          <SlashingSequence />
        </Suspense>
      </Physics>

      {/* Postprocessing — bloom is essential for the "premium luminous" look. */}
      <EffectComposer multisampling={0}>
        <Bloom
          intensity={1.4}
          luminanceThreshold={0.25}
          luminanceSmoothing={0.4}
          mipmapBlur
        />
        <ChromaticAberration
          offset={new THREE.Vector2(0.0008, 0.0008)}
          radialModulation
          modulationOffset={0.5}
          blendFunction={BlendFunction.NORMAL}
        />
        <Vignette eskil={false} offset={0.2} darkness={0.7} />
      </EffectComposer>
    </>
  );
}

/**
 * Installs a global window.triggerTestSlash() function during development so
 * we can fire a slash from the browser console before the HUD is built.
 *
 * Usage from console:
 *   triggerTestSlash()                  → slashes a random non-genesis node
 *   triggerTestSlash('routing-7')       → slashes a specific node by id
 *   triggerTestSlash('routing')         → slashes a random node of that type
 *
 * The function is also exposed as window.__ahin for richer introspection.
 */
function TestSlashBinding() {
  const { clock } = useThree();
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const triggerTestSlash = (selector?: string) => {
      const net = useNetworkStore.getState();
      const slash = useSlashStore.getState();
      let candidates = net.nodes.filter((n) => n.health === 'healthy');
      // Don't slash genesis by default — it's the central attractor and
      // removing it makes the topology fly apart.
      if (!selector) {
        candidates = candidates.filter((n) => n.type !== 'genesis');
      } else if (selector.includes('-')) {
        candidates = candidates.filter((n) => n.id === selector);
      } else {
        candidates = candidates.filter((n) => n.type === selector);
      }
      if (candidates.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[ahin] no eligible node for triggerTestSlash', selector);
        return null;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      slash.triggerSlash(pick.id, clock.elapsedTime);
      // eslint-disable-next-line no-console
      console.log(`[ahin] triggered slash on ${pick.id} (${pick.type})`);
      return pick.id;
    };

    (window as unknown as Record<string, unknown>).triggerTestSlash =
      triggerTestSlash;
    (window as unknown as Record<string, unknown>).__ahin = {
      triggerTestSlash,
      network: useNetworkStore,
      slash: useSlashStore,
    };

    // eslint-disable-next-line no-console
    console.log(
      '%c[ahin] Phase 2 test trigger ready. Call triggerTestSlash() from the console.',
      'color:#ff8a4c;font-weight:bold',
    );

    return () => {
      delete (window as unknown as Record<string, unknown>).triggerTestSlash;
      delete (window as unknown as Record<string, unknown>).__ahin;
    };
  }, [clock]);
  return null;
}

/**
 * Top-level Scene component — wraps everything in a Canvas.
 *
 * Camera FOV and position are tuned to frame the action with the boardroom
 * mockup's slightly cinematic feel: ~50° FOV, camera slightly above and
 * pulled back so the network reads as a "stage" the viewer is observing.
 */
export function Scene() {
  return (
    <Canvas
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      dpr={[1, 2]}
      camera={{
        position: [0, 4, 26],
        fov: 50,
        near: 0.1,
        far: 200,
      }}
      shadows={false}
      style={{ position: 'absolute', inset: 0 }}
    >
      <SceneContents />
    </Canvas>
  );
}
