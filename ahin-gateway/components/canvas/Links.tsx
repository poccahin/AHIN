'use client';

/**
 * Links — instanced ribbon links driven by the linkPulse GLSL shader.
 *
 * Architecture (Phase 4):
 *   - Geometry: a single unit quad (2 triangles, positions x in [0,1],
 *     y in [-0.5,0.5]) made into an InstancedBufferGeometry.
 *   - Per-instance attributes (Float32 buffer attributes, updated each frame):
 *     aSource, aTarget, aErrored, aColor, aPulsePhase, aIntensity.
 *   - One ShaderMaterial shared across all instances.
 *
 * Performance: one draw call for up to MAX_LINKS=128 links. The vertex
 * shader handles screen-space billboarding + per-link length stretch + the
 * glitch-noise displacement on errored links. The fragment shader produces
 * the traveling pulse (healthy) or glitchy lightning (errored).
 *
 * Memory discipline: geometry, material, attribute buffers, and the
 * shader's uniform refs are all disposed on unmount.
 */

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useNetworkStore } from '@/lib/state/networkStore';
import { NODE_TYPES } from '@/lib/constants/nodeTypes';
import { linkVertexShader, linkFragmentShader } from '@/lib/shaders/linkPulse';

/** Maximum simultaneous links rendered. Reserve once, never reallocate. */
const MAX_LINKS = 128;

export function Links() {
  const { size, gl } = useThree();

  // ---- Per-instance Float32 buffers ----
  const buffers = useMemo(
    () => ({
      aSource: new Float32Array(MAX_LINKS * 3),
      aTarget: new Float32Array(MAX_LINKS * 3),
      aErrored: new Float32Array(MAX_LINKS),
      aColor: new Float32Array(MAX_LINKS * 3),
      aPulsePhase: new Float32Array(MAX_LINKS),
      aIntensity: new Float32Array(MAX_LINKS),
    }),
    [],
  );

  // ---- Geometry: unit quad + per-instance attrs ----
  const geometry = useMemo(() => {
    const geom = new THREE.InstancedBufferGeometry();
    // Unit quad: two triangles. Note y in [-0.5, 0.5] so vSide maps correctly.
    const quadVerts = new Float32Array([
      // tri 1
      0, -0.5, 0,
      1, -0.5, 0,
      1,  0.5, 0,
      // tri 2
      0, -0.5, 0,
      1,  0.5, 0,
      0,  0.5, 0,
    ]);
    geom.setAttribute('position', new THREE.BufferAttribute(quadVerts, 3));

    // Per-instance attributes.
    geom.setAttribute(
      'aSource',
      new THREE.InstancedBufferAttribute(buffers.aSource, 3),
    );
    geom.setAttribute(
      'aTarget',
      new THREE.InstancedBufferAttribute(buffers.aTarget, 3),
    );
    geom.setAttribute(
      'aErrored',
      new THREE.InstancedBufferAttribute(buffers.aErrored, 1),
    );
    geom.setAttribute(
      'aColor',
      new THREE.InstancedBufferAttribute(buffers.aColor, 3),
    );
    geom.setAttribute(
      'aPulsePhase',
      new THREE.InstancedBufferAttribute(buffers.aPulsePhase, 1),
    );
    geom.setAttribute(
      'aIntensity',
      new THREE.InstancedBufferAttribute(buffers.aIntensity, 1),
    );

    geom.instanceCount = 0;
    // Skip frustum culling — we have ~50 quads max, not worth the cost,
    // and the screen-space billboarding makes per-instance bounds unreliable.
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    return geom;
  }, [buffers]);

  // ---- Material ----
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: linkVertexShader,
      fragmentShader: linkFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uViewport: { value: new THREE.Vector2(size.width, size.height) },
        uPixelRatio: { value: gl.getPixelRatio() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // size/gl are stable references for the lifetime; we update uViewport
    // imperatively in the useEffect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep uViewport in sync if the canvas resizes.
  useEffect(() => {
    material.uniforms.uViewport.value.set(size.width, size.height);
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  }, [size, gl, material]);

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // ---- Per-frame update ----
  const nodeIndex = useMemo(() => new Map<string, number>(), []);

  useFrame((state) => {
    const store = useNetworkStore.getState();
    const { nodes, links } = store;

    // Refresh node index.
    nodeIndex.clear();
    for (let i = 0; i < nodes.length; i++) nodeIndex.set(nodes[i].id, i);

    let writeIdx = 0;
    const max = Math.min(links.length, MAX_LINKS);
    for (let li = 0; li < max; li++) {
      const link = links[li];
      const ai = nodeIndex.get(link.sourceId);
      const bi = nodeIndex.get(link.targetId);
      if (ai === undefined || bi === undefined) continue;
      const na = nodes[ai];
      const nb = nodes[bi];
      if (na.health === 'collapsing' || na.health === 'banished') continue;
      if (nb.health === 'collapsing' || nb.health === 'banished') continue;

      const w = writeIdx;
      const w3 = w * 3;

      buffers.aSource[w3] = na.position[0];
      buffers.aSource[w3 + 1] = na.position[1];
      buffers.aSource[w3 + 2] = na.position[2];
      buffers.aTarget[w3] = nb.position[0];
      buffers.aTarget[w3 + 1] = nb.position[1];
      buffers.aTarget[w3 + 2] = nb.position[2];

      buffers.aErrored[w] = link.errored ? 1 : 0;

      // Base color: error-red when errored, else endpoint blend.
      if (link.errored) {
        buffers.aColor[w3] = 1.0;
        buffers.aColor[w3 + 1] = 0.1;
        buffers.aColor[w3 + 2] = 0.17;
      } else {
        const ca = NODE_TYPES[na.type].color;
        const cb = NODE_TYPES[nb.type].color;
        const ar = ((ca >> 16) & 0xff) / 255;
        const ag = ((ca >> 8) & 0xff) / 255;
        const ab = (ca & 0xff) / 255;
        const br = ((cb >> 16) & 0xff) / 255;
        const bg = ((cb >> 8) & 0xff) / 255;
        const bb = (cb & 0xff) / 255;
        buffers.aColor[w3] = (ar + br) * 0.5;
        buffers.aColor[w3 + 1] = (ag + bg) * 0.5;
        buffers.aColor[w3 + 2] = (ab + bb) * 0.5;
      }

      buffers.aPulsePhase[w] = link.pulsePhase;
      buffers.aIntensity[w] = link.intensity;

      writeIdx++;
    }

    // Apply count + flag attribute updates.
    geometry.instanceCount = writeIdx;
    (geometry.getAttribute('aSource') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aTarget') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aErrored') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aPulsePhase') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aIntensity') as THREE.InstancedBufferAttribute).needsUpdate = true;

    // Advance time.
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
