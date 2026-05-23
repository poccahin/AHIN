'use client';

/**
 * AhinGateway — Phase 3 root component.
 *
 * Mounts the 3D canvas and the full boardroom HUD overlay on top of it.
 * The HUD is `pointer-events-none` at the container level with each panel
 * restoring `pointer-events-auto` — so clicks pass through to the canvas
 * wherever there's no UI.
 */

import dynamic from 'next/dynamic';
import { HudOverlay } from './hud/HudOverlay';

// Scene must be client-only (uses WebGL / browser APIs). Dynamic import with
// SSR disabled prevents Next from trying to render it server-side.
const Scene = dynamic(
  () => import('./canvas/Scene').then((m) => m.Scene),
  { ssr: false },
);

export function AhinGateway() {
  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#05060a]">
      {/* 3D canvas fills the viewport. */}
      <Scene />

      {/* Radial vignette over the canvas, BELOW the HUD so it doesn't
          dim the glass panels themselves. */}
      <div
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* Full HUD overlay — pointer-events transparent except on panels. */}
      <HudOverlay />
    </div>
  );
}
