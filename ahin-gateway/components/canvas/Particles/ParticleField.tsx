'use client';

/**
 * Unified particle effects system.
 *
 * Each node type has its own ambient particle aura per the brief:
 *   - Genesis     → upward-flowing warm ember sparks
 *   - Sentinel    → slow pulsating plasma aura (orbital ring of dots)
 *   - Routing     → high-speed cascading data-stream pulses (radial outflow)
 *   - Settlement  → solid radiant light rays (radial spokes)
 *   - Eco         → expanding breathing ripples (expanding ring shells)
 *
 * Rendering strategy: ONE THREE.Points object per node type, batching all
 * particles for that type across all nodes. Per-particle state (position,
 * velocity, life, parent node id) lives in plain Float32 buffers, updated
 * on CPU each frame and uploaded to GPU as a buffer attribute.
 *
 * Why CPU updates? With ~32 nodes × ~30 particles each ≈ 1000 particles,
 * we're well within CPU budget per frame (well under 1ms). The simplicity
 * is worth it. If we ever push to 10k+ we'd move to a compute-shader pass.
 */

import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useNetworkStore } from '@/lib/state/networkStore';
import { NODE_TYPES, NODE_TYPE_LIST } from '@/lib/constants/nodeTypes';
import type { NodeType, AhinNode } from '@/types/network';

/** Particles per node, per type. */
const PARTICLES_PER_NODE: Record<NodeType, number> = {
  genesis: 60,
  sentinel: 24,
  routing: 40,
  settlement: 16,
  eco: 32,
};

/** Approximate max nodes per type for buffer pre-allocation. */
const MAX_NODES_PER_TYPE = 24;

interface ParticleSystem {
  type: NodeType;
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  positions: Float32Array;     // x, y, z per particle
  velocities: Float32Array;
  lives: Float32Array;          // remaining life (seconds)
  maxLives: Float32Array;       // initial life (for fade calc)
  parentSeed: Float32Array;     // owning node seed (used for parent-id-free assignment)
  count: number;                // active particle count
  capacity: number;
}

/** Build one ParticleSystem for a node type. */
function buildSystem(type: NodeType): ParticleSystem {
  const capacity = PARTICLES_PER_NODE[type] * MAX_NODES_PER_TYPE;
  const positions = new Float32Array(capacity * 3);
  const velocities = new Float32Array(capacity * 3);
  const lives = new Float32Array(capacity);
  const maxLives = new Float32Array(capacity);
  const parentSeed = new Float32Array(capacity);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Use per-vertex alpha via color-attribute-as-alpha hack: encode alpha in
  // color buffer's R channel and have the material multiply opacity by it.
  const colors = new Float32Array(capacity * 3).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const cfg = NODE_TYPES[type];
  const sizeByType: Record<NodeType, number> = {
    genesis: 0.18,
    sentinel: 0.14,
    routing: 0.12,
    settlement: 0.16,
    eco: 0.15,
  };

  const material = new THREE.PointsMaterial({
    color: cfg.color,
    size: sizeByType[type],
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    vertexColors: true,
    map: createSoftDiscTexture(),
  });

  // Initially nothing is alive — useFrame will spawn as needed.
  geometry.setDrawRange(0, 0);

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  return {
    type,
    points,
    geometry,
    material,
    positions,
    velocities,
    lives,
    maxLives,
    parentSeed,
    count: 0,
    capacity,
  };
}

/** Build a soft circular sprite texture for particles. */
function createSoftDiscTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Spawn a new particle for `node` into `sys`. Caller has verified there's
 * room. Behavior differs by type — defined in `respawn` below.
 */
function spawnFor(sys: ParticleSystem, node: AhinNode, index: number): void {
  const i3 = index * 3;
  const px = node.position[0];
  const py = node.position[1];
  const pz = node.position[2];
  const r = 0.4 * node.scale; // emission radius near surface

  switch (sys.type) {
    case 'genesis': {
      // Embers: spawn at random surface point, rise upward with slight drift.
      const ang = Math.random() * Math.PI * 2;
      const elev = Math.random() * 0.5 - 0.25; // mostly horizontal start
      sys.positions[i3]     = px + Math.cos(ang) * r;
      sys.positions[i3 + 1] = py + elev;
      sys.positions[i3 + 2] = pz + Math.sin(ang) * r;
      sys.velocities[i3]     = (Math.random() - 0.5) * 0.4;
      sys.velocities[i3 + 1] = 0.8 + Math.random() * 0.6; // strong upward
      sys.velocities[i3 + 2] = (Math.random() - 0.5) * 0.4;
      sys.maxLives[index] = sys.lives[index] = 1.4 + Math.random() * 0.6;
      break;
    }
    case 'sentinel': {
      // Plasma: orbit slowly in a horizontal ring around the node.
      const ang = Math.random() * Math.PI * 2;
      const r2 = r * 1.8 + Math.random() * 0.5;
      sys.positions[i3]     = px + Math.cos(ang) * r2;
      sys.positions[i3 + 1] = py + (Math.random() - 0.5) * 0.6;
      sys.positions[i3 + 2] = pz + Math.sin(ang) * r2;
      // Tangential velocity (slow orbit).
      const speed = 0.4 + Math.random() * 0.3;
      sys.velocities[i3]     = -Math.sin(ang) * speed;
      sys.velocities[i3 + 1] = (Math.random() - 0.5) * 0.1;
      sys.velocities[i3 + 2] = Math.cos(ang) * speed;
      sys.maxLives[index] = sys.lives[index] = 2.8 + Math.random() * 0.8;
      break;
    }
    case 'routing': {
      // Data streams: spawn at surface, accelerate outward radially fast.
      const ang = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dx = Math.sin(phi) * Math.cos(ang);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(ang);
      sys.positions[i3]     = px + dx * r;
      sys.positions[i3 + 1] = py + dy * r;
      sys.positions[i3 + 2] = pz + dz * r;
      const speed = 2.2 + Math.random() * 1.0;
      sys.velocities[i3]     = dx * speed;
      sys.velocities[i3 + 1] = dy * speed;
      sys.velocities[i3 + 2] = dz * speed;
      sys.maxLives[index] = sys.lives[index] = 0.7 + Math.random() * 0.3;
      break;
    }
    case 'settlement': {
      // Radiant rays: orbit very slowly, mostly stationary, near surface.
      const ang = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dx = Math.sin(phi) * Math.cos(ang);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(ang);
      sys.positions[i3]     = px + dx * r * 1.4;
      sys.positions[i3 + 1] = py + dy * r * 1.4;
      sys.positions[i3 + 2] = pz + dz * r * 1.4;
      sys.velocities[i3]     = dx * 0.15;
      sys.velocities[i3 + 1] = dy * 0.15;
      sys.velocities[i3 + 2] = dz * 0.15;
      sys.maxLives[index] = sys.lives[index] = 2.0 + Math.random() * 1.0;
      break;
    }
    case 'eco': {
      // Breathing ripples: spawn just outside surface, drift outward slowly,
      // then fade. Visually: expanding shells.
      const ang = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dx = Math.sin(phi) * Math.cos(ang);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(ang);
      sys.positions[i3]     = px + dx * r * 1.1;
      sys.positions[i3 + 1] = py + dy * r * 1.1;
      sys.positions[i3 + 2] = pz + dz * r * 1.1;
      const speed = 0.6 + Math.random() * 0.3;
      sys.velocities[i3]     = dx * speed;
      sys.velocities[i3 + 1] = dy * speed;
      sys.velocities[i3 + 2] = dz * speed;
      sys.maxLives[index] = sys.lives[index] = 1.6 + Math.random() * 0.4;
      break;
    }
  }

  sys.parentSeed[index] = node.seed;
}

/**
 * Per-type particle update logic. Mostly: velocity integration + life decay,
 * with type-specific tweaks (Genesis: gravity-defying lift, Sentinel: orbit
 * tangent re-projection, etc.).
 */
function tickSystem(sys: ParticleSystem, dt: number): void {
  let writeIdx = 0;
  const writePos = sys.positions;
  const writeVel = sys.velocities;
  const writeLife = sys.lives;
  const writeMax = sys.maxLives;
  const writeSeed = sys.parentSeed;

  const colors = (sys.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;

  for (let i = 0; i < sys.count; i++) {
    const i3 = i * 3;
    const life = writeLife[i] - dt;
    if (life <= 0) continue; // expire (don't copy forward)

    // Integrate position.
    let vx = writeVel[i3];
    let vy = writeVel[i3 + 1];
    let vz = writeVel[i3 + 2];

    // Per-type velocity modifiers.
    if (sys.type === 'genesis') {
      vy += 0.5 * dt; // continued buoyancy
      vx *= 0.99;
      vz *= 0.99;
    } else if (sys.type === 'sentinel') {
      // Damping toward orbit speed — already tangential at spawn.
      vx *= 0.995;
      vz *= 0.995;
    } else if (sys.type === 'routing') {
      // Slight deceleration so streams don't fly forever.
      vx *= 0.97;
      vy *= 0.97;
      vz *= 0.97;
    } else if (sys.type === 'eco') {
      // Slight outward easing.
      vx *= 0.99;
      vy *= 0.99;
      vz *= 0.99;
    }

    const nx = writePos[i3] + vx * dt;
    const ny = writePos[i3 + 1] + vy * dt;
    const nz = writePos[i3 + 2] + vz * dt;

    // Write back into the next slot (compaction).
    const w3 = writeIdx * 3;
    writePos[w3] = nx;
    writePos[w3 + 1] = ny;
    writePos[w3 + 2] = nz;
    writeVel[w3] = vx;
    writeVel[w3 + 1] = vy;
    writeVel[w3 + 2] = vz;
    writeLife[writeIdx] = life;
    writeMax[writeIdx] = writeMax[i];
    writeSeed[writeIdx] = writeSeed[i];

    // Fade alpha via vertex color (R channel as alpha proxy multiplier).
    const fade = Math.max(0, life / writeMax[i]);
    colors[w3] = fade;
    colors[w3 + 1] = fade;
    colors[w3 + 2] = fade;

    writeIdx++;
  }

  sys.count = writeIdx;

  // Flag uploads.
  (sys.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  (sys.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  sys.geometry.setDrawRange(0, sys.count);
}

/**
 * Public component. Mounts once inside the scene.
 */
export function ParticleField() {
  // Build systems once.
  const systems = useMemo<ParticleSystem[]>(
    () => NODE_TYPE_LIST.map((t) => buildSystem(t)),
    [],
  );

  const groupRef = useRef<THREE.Group>(null);

  // Track per-node accumulated spawn debt so we can spawn at a steady rate.
  const spawnDebt = useRef<Map<string, number>>(new Map());

  useFrame((_, dt) => {
    const store = useNetworkStore.getState();
    const stepDt = Math.min(dt, 1 / 30);

    // 1) Advance and compact existing particles.
    for (const sys of systems) tickSystem(sys, stepDt);

    // 2) Spawn new particles per active node.
    for (const node of store.nodes) {
      if (node.health !== 'healthy') continue;
      const sys = systems.find((s) => s.type === node.type);
      if (!sys) continue;

      const targetRate = PARTICLES_PER_NODE[node.type] / 1.5; // particles/sec/node
      const debt = (spawnDebt.current.get(node.id) ?? 0) + targetRate * stepDt;
      const toSpawn = Math.floor(debt);
      spawnDebt.current.set(node.id, debt - toSpawn);

      for (let k = 0; k < toSpawn; k++) {
        if (sys.count >= sys.capacity) break;
        spawnFor(sys, node, sys.count);
        sys.count++;
      }
    }
  });

  // Cleanup: dispose GPU resources on unmount.
  useEffect(() => {
    return () => {
      for (const sys of systems) {
        sys.geometry.dispose();
        sys.material.dispose();
        if (sys.material.map) sys.material.map.dispose();
      }
    };
  }, [systems]);

  return (
    <group ref={groupRef}>
      {systems.map((s) => (
        <primitive key={s.type} object={s.points} />
      ))}
    </group>
  );
}
