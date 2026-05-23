# AHIN Gateway — Phase 4: GLSL Shaders, Telemetry & Cinematography

Production-grade 3D interactive gateway for **ahin.io** (Active Hashed Interaction Networks).

This is **Phase 4** — the final delivery of the four-phase build:
- ✅ **Phase 1** — Node system, force-directed topology, particle auras
- ✅ **Phase 2** — PoCC slashing pipeline (DETECTION → COLLAPSE → BANISHED)
- ✅ **Phase 3** — Full boardroom HUD overlay wired to the stores
- ✅ **Phase 4** *(this delivery)* — Custom GLSL shaders, right-side telemetry, cinematic camera rig

---

## What's new in Phase 4

### 1. Custom GLSL link shader (`lib/shaders/linkPulse.ts`)

Links are now rendered via a single `THREE.ShaderMaterial` on an `InstancedBufferGeometry` of unit quads. **One draw call** for up to 128 links. The vertex shader stretches each unit quad between its source and target endpoints with screen-space billboarding (consistent CSS-pixel thickness regardless of camera distance), and applies high-frequency perpendicular hash-noise displacement when the link is errored — the result is **glitch-red lightning** instead of the smooth pulse seen on healthy links.

Per-instance attributes: `aSource`, `aTarget`, `aErrored`, `aColor`, `aPulsePhase`, `aIntensity`.
Shared uniforms: `uTime`, `uViewport`, `uPixelRatio`.

Fragment shader behaviors:
- **Healthy**: traveling sine-windowed pulse from source→target, plus a faint back-traveling glimmer, on a low-luminance filament base of the link's color.
- **Errored**: 14-cell flicker noise with a sweeping bright cell, against a dark-red base — reads as "system corruption."

### 2. CausalFlash — consensus completion flares (`components/canvas/CausalFlash.tsx`)

Pooled `InstancedMesh` of unit spheres. When `triggerCausalFlash(pos, color)` is called, a free slot is grabbed and the flare scales up rapidly with `easeOutCubic`, then fades alpha with **e^(-σt)** decay (σ=5.5). Lifetime is 0.7 s. The pool holds 32 slots — full pool drops the queued spawn rather than allocating.

`CausalFlashDriver.tsx` ticks at ~2.2 Hz, picking a random healthy non-errored link and spawning a warm-amber flare at its midpoint to convey "consensus events streaming through the network."

### 3. CameraRig (`components/canvas/CameraRig.tsx`)

Replaces the Phase 1/2 `CameraDrift` with a unified rig:
- **OrbitControls** with `dampingFactor=0.05`, `maxDistance=40`, `minDistance=12`, pitch limited to ~18°–82° so the scene never inverts.
- **Lissajous drift** on the controls' target (X amp 0.45 @ 0.07 Hz, Y amp 0.3 @ 0.09 Hz, Z amp 0.25 @ 0.05 Hz). The target is smoothly lerped toward the drift point each frame (lerp factor 0.04) so user-orbited yaw/pitch is preserved.
- **Proximity-aware shake**: subscribes to `slashStore` and fires a shake event when a record enters COLLAPSE. Shake amplitude scales as `1 / (distance/12)^0.9`, capped at 0.6 world units. Decay is `exp(-4.5 · t)`. Per-axis sinusoidal at 38–58 Hz with randomized phase per event so successive shakes don't sync.

The shake is applied **additively to `camera.position`** after OrbitControls' update (drei's OrbitControls runs at `useFrame(..., -1)`, so our default-priority frame callback runs after it). OrbitControls re-resolves position from orbit math each frame, so our offset is naturally non-persistent — no manual undo needed.

### 4. Right-side telemetry panels

**`ProtocolEvidencePanel.tsx`** (top of right column):
- *PoCC Validation Anchor* — a 64-character hex string driven by `lib/hexHash.ts`. Each character has its own update rate (60% slow @ 0.1–0.25 Hz, 30% medium @ 0.5–1.1 Hz, 10% fast @ 2–8 Hz), giving the effect of a mostly-stable cryptographic root with a handful of actively cycling characters.
- *Consensus Metrics* — three-column readout (validation loops, verification latency, proof depth) with values that drift smoothly.
- *Evidence Stream* — recent slash records appear as red-bordered rows with their pseudo-hashes (first 5 + last 5 chars) and timestamps. Animated via `<AnimatePresence>` for smooth row enter/exit. Capped at 5 visible.

**`SystemHealth.tsx`** (below it):
- *Active Agent Core Subsystems* — per-type horizontal load bars (Catalyst / Sentinel / Routing / Settlement / Eco) animated via framer-motion with their healthy/total counts.
- *Infrastructure* — Compute Uptime (positive emerald), Memory Overhead (neutral), Treasury Allocation ($LIFE++, accent amber). Values oscillate gently around realistic anchors.

Both panels slide in from `x:50 → 0` with staggered delays (300 ms / 420 ms) on first mount.

---

## Updated architecture

```
components/canvas/
├── CameraRig.tsx          ← NEW: OrbitControls + drift + shake
├── CausalFlash.tsx        ← NEW: Pooled e^(-σt) flares
├── CausalFlashDriver.tsx  ← NEW: Auto-spawn on healthy link midpoints
├── Links.tsx              ← REWRITTEN: GLSL ribbon, 1 draw call
└── ... (other Phase 1-2 files)

components/hud/
├── ProtocolEvidencePanel.tsx  ← NEW: PoCC hash + metrics + evidence
├── SystemHealth.tsx           ← NEW: Agent load + infrastructure
├── HudOverlay.tsx             ← UPDATED: right-column flex stack
└── ... (other Phase 3 panels)

lib/
├── shaders/linkPulse.ts   ← NEW: vertex + fragment GLSL source
├── hexHash.ts             ← NEW: rolling pseudo-hash helpers
└── ... (other Phase 1-3 files)
```

---

## Memory discipline

Every WebGL resource is disposed on unmount:
- **Links**: `geometry.dispose()` and `material.dispose()` in cleanup useEffect; per-instance Float32 buffers are GC'd with the component.
- **CausalFlash**: `geometry.dispose()` and `material.dispose()` in cleanup; per-slot state arrays are GC'd.
- **CameraRig**: drei's `OrbitControls` handles its own dispose on unmount; shake event arrays are component-local refs that GC normally.
- **AshBurst / ShatteringNode**: already disposed correctly in Phase 2.

`slashStore` and `networkStore` subscribers in CameraRig and ProtocolEvidencePanel return their `unsubscribe` functions from useEffect, preventing leaks across HMR remounts.

---

## Run it

```bash
npm install
npm run build   # production build sanity-check
npm run dev     # http://localhost:3000
```

**Try:**
- **Drag with the mouse**: smooth orbit, zoom with wheel.
- **Click Causal Guard or Kill Switch**: watch the camera rumble in sync with the slash, with closer slashes producing more violent shake. Errored links flash into red glitch-lightning.
- **Watch the right-side panels**: PoCC anchor characters cycle live; when a slash fires, a new row appears at the top of the Evidence Stream with a fresh pseudo-hash.
- **From the console**: `triggerTestSlash()`, `triggerTestSlash('routing')`, `__ahin.slash.getState().records`.

---

## Phase 4 review checklist

- [ ] **Healthy links pulse**: smooth fluid pulses traveling source→target; back-traveling glimmer adds richness
- [ ] **Errored links glitch**: jagged red lightning with high-frequency flicker and a sweeping bright cell
- [ ] **CausalFlash flares feel like quantum confirmation**: rapid scale-up, exp(-σt) fade, warm amber core
- [ ] **OrbitControls feel luxurious**: damping is buttery, zoom range is constrained, pitch never inverts
- [ ] **Camera shake is proximity-correct**: near slashes rumble hard, distant slashes are subtle
- [ ] **Lissajous drift is gentle and unrepetitive**: scene breathes when idle
- [ ] **PoCC anchor reads as "live crypto"**: most chars stable, a few scrolling
- [ ] **Evidence Stream reacts to slashes**: row appears with hash + timestamp on each slash
- [ ] **System Health bars animate live**: per-type load oscillates smoothly
- [ ] **Right column auto-stacks**: panels never overlap regardless of evidence growth

**Tuning knobs:**
- Link shader healthy-pulse speed: `linkPulse.ts` → `uTime * 0.5` term in frag
- Link shader errored flicker rate: `linkPulse.ts` → `uTime * 18.0` in vertex hash, `* 30.0` in frag
- CausalFlash sigma: `CausalFlash.tsx` → `FLASH_SIGMA`
- CausalFlash spawn rate: `CausalFlashDriver.tsx` → `FLASH_RATE_HZ`
- Camera drift amplitudes/frequencies: `CameraRig.tsx` → `DRIFT_AMP`, `DRIFT_FREQ`
- Shake severity: `CameraRig.tsx` → `SHAKE_BASE_AMPLITUDE`, `SHAKE_DECAY`, `SHAKE_MAX`
- PoCC hash character cycle rates: `lib/hexHash.ts` → `rollingHexHash` rate constants
- Evidence Stream max rows: `ProtocolEvidencePanel.tsx` → `MAX_EVIDENCE_ROWS`

---

## Deployment

The project is Vercel-ready out of the box:

```bash
# From the project root:
vercel --prod
```

`next.config.js` is configured with `transpilePackages: ['three']` and a GLSL raw-loader rule for future external shader files. The page is force-dynamic to avoid SSR of WebGL code. First Load JS is 136 kB.

No environment variables required for the static-presentation build. If you wire real chain data later, add `NEXT_PUBLIC_RPC_URL` etc to a `.env.local` and consume from a new `lib/chain.ts` module.

---

## Final size budget

| Route | Size | First Load |
|---|---|---|
| `/` | 49.1 kB | 136 kB |
| `/_not-found` | 871 B | 88.1 kB |
| Shared chunks | 87.3 kB | — |

The full 4-phase deck (force solver + 5 voxel-character node families + InstancedMesh field + particle auras + Rapier slashing + GLSL link shader + CausalFlash + 5 HUD panels + telemetry + OrbitControls + postprocessing pipeline) ships in **136 kB of First Load JS**.
