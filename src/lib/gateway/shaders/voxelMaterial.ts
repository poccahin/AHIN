'use client';

/**
 * Voxel material library.
 *
 * Five distinct material families, one per node type, plus shared face and
 * glyph materials. All materials are MeshPhysicalMaterial — fast, PBR, and
 * support emissive + transmission/clearcoat for the "premium" boardroom feel.
 *
 * Materials are cached per (type, kind) so the InstancedMesh field doesn't
 * recreate them on every render.
 *
 * Phase 1 trades off some custom-shader sophistication for stability and
 * frame-rate. Phase 4 can swap in custom GLSL onBeforeCompile patches for
 * effects like:
 *   - Routing's cascading data-stream pulses along the surface
 *   - Eco's slow breathing iridescence
 *   - Genesis's molten heat-distortion
 * For now, emissive pulsing + IOR + clearcoat gets us 90% of the look.
 */

import * as THREE from 'three';
import type { NodeType } from '@/src/types/gateway';
import { NODE_TYPES } from '@/src/lib/gateway/constants/nodeTypes';
import type { VoxelKind } from '@/src/lib/gateway/constants/shapes';

/** Animation hook: store materials needing per-frame emissive modulation. */
const animatedMaterials: Array<{
  mat: THREE.MeshPhysicalMaterial;
  baseEmissive: number;
  freq: number;
  amp: number;
  phase: number;
}> = [];

/** Called by Scene.tsx's useFrame to drive emissive pulses. */
export function updateMaterialAnimations(elapsed: number): void {
  for (const a of animatedMaterials) {
    const t = Math.sin(elapsed * a.freq + a.phase) * 0.5 + 0.5;
    a.mat.emissiveIntensity = a.baseEmissive + t * a.amp;
  }
}

const materialCache = new Map<string, THREE.Material>();

/** Shared white face material — used by all 5 types for the "eye panel" backing. */
function buildFaceMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf6f4ee,           // warm cream ivory
    roughness: 0.35,
    metalness: 0.05,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    emissive: 0xffffff,
    emissiveIntensity: 0.18,   // gentle self-illumination
  });
}

/**
 * Build the body material for a given node type. Each type is a different
 * physical "substance" per the brief.
 */
function buildBodyMaterial(type: NodeType): THREE.MeshPhysicalMaterial {
  const cfg = NODE_TYPES[type];

  switch (type) {
    case 'genesis': {
      // "Molten glass core" — orange, very emissive, slight transmission for inner glow.
      const m = new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        emissive: cfg.emissive,
        emissiveIntensity: 1.6,
        roughness: 0.25,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.15,
        transmission: 0.18,
        thickness: 0.6,
        ior: 1.5,
      });
      animatedMaterials.push({ mat: m, baseEmissive: 1.2, freq: 1.6, amp: 0.8, phase: 0 });
      return m;
    }

    case 'sentinel': {
      // "Deep amethyst crystal" — high clearcoat, slight transmission, slow pulse.
      const m = new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        emissive: cfg.emissive,
        emissiveIntensity: 0.7,
        roughness: 0.15,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        transmission: 0.25,
        thickness: 0.8,
        ior: 1.7,
      });
      animatedMaterials.push({ mat: m, baseEmissive: 0.55, freq: 0.6, amp: 0.4, phase: 1.5 });
      return m;
    }

    case 'routing': {
      // "Liquid fiber optics" — high clearcoat, modest transmission, fast pulse.
      const m = new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        emissive: cfg.emissive,
        emissiveIntensity: 1.0,
        roughness: 0.18,
        metalness: 0.2,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        transmission: 0.1,
        thickness: 0.3,
        ior: 1.45,
      });
      animatedMaterials.push({ mat: m, baseEmissive: 0.8, freq: 3.4, amp: 0.7, phase: 0.5 });
      return m;
    }

    case 'settlement': {
      // "Polished luminescent aurum" — metallic, smooth, sharp specular.
      const m = new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        emissive: cfg.emissive,
        emissiveIntensity: 0.55,
        roughness: 0.12,
        metalness: 0.95,
        clearcoat: 0.7,
        clearcoatRoughness: 0.05,
      });
      animatedMaterials.push({ mat: m, baseEmissive: 0.45, freq: 0.9, amp: 0.25, phase: 2.0 });
      return m;
    }

    case 'eco': {
      // "Bio-luminescent organic lattice" — green, soft, slow breathing.
      const m = new THREE.MeshPhysicalMaterial({
        color: cfg.color,
        emissive: cfg.emissive,
        emissiveIntensity: 0.85,
        roughness: 0.3,
        metalness: 0.0,
        clearcoat: 0.85,
        clearcoatRoughness: 0.2,
        transmission: 0.12,
        thickness: 0.5,
        ior: 1.4,
      });
      animatedMaterials.push({ mat: m, baseEmissive: 0.7, freq: 0.4, amp: 0.5, phase: 3.0 });
      return m;
    }
  }
}

/**
 * Build the glyph material — the ++ or -- eye cubes. Always highly emissive
 * in the node's signature color so the "face" reads at a glance.
 */
function buildGlyphMaterial(type: NodeType): THREE.MeshPhysicalMaterial {
  const cfg = NODE_TYPES[type];
  const m = new THREE.MeshPhysicalMaterial({
    color: cfg.color,
    emissive: cfg.color,
    emissiveIntensity: 2.4,
    roughness: 0.2,
    metalness: 0.0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
  });
  animatedMaterials.push({
    mat: m,
    baseEmissive: 2.0,
    freq: 2.2,
    amp: 0.6,
    phase: Math.random() * Math.PI * 2,
  });
  return m;
}

/**
 * Shared "slashed glyph" material — used for ALL types during the DETECTION
 * phase. Bright red, very emissive, with a fast erratic flicker that reads
 * as a hard error / hallucination signal.
 */
let _slashedGlyphMat: THREE.MeshPhysicalMaterial | null = null;
export function getSlashedGlyphMaterial(): THREE.MeshPhysicalMaterial {
  if (_slashedGlyphMat) return _slashedGlyphMat;
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xff1a2c,
    emissive: 0xff2030,
    emissiveIntensity: 3.0,
    roughness: 0.15,
    metalness: 0.0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.2,
  });
  // Fast, jittery flicker — 8 Hz pulse pushed hard.
  animatedMaterials.push({
    mat: m,
    baseEmissive: 2.4,
    freq: 8.0,
    amp: 1.6,
    phase: 0,
  });
  _slashedGlyphMat = m;
  return m;
}

/**
 * Public entry point. Returns a cached material for the (type, kind) pair.
 */
export function buildMaterial(type: NodeType, kind: VoxelKind): THREE.Material {
  const key = `${type}:${kind}`;
  let cached = materialCache.get(key);
  if (cached) return cached;

  let mat: THREE.Material;
  switch (kind) {
    case 'body':
      mat = buildBodyMaterial(type);
      break;
    case 'face':
      mat = buildFaceMaterial();
      break;
    case 'glyph':
      mat = buildGlyphMaterial(type);
      break;
  }

  materialCache.set(key, mat);
  return mat;
}

/** Clean disposal — call on hot-module-reload or unmount. */
export function disposeAllMaterials(): void {
  for (const mat of materialCache.values()) mat.dispose();
  materialCache.clear();
  if (_slashedGlyphMat) {
    _slashedGlyphMat.dispose();
    _slashedGlyphMat = null;
  }
  animatedMaterials.length = 0;
}
