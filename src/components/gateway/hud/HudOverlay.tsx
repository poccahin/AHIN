'use client';

/**
 * HudOverlay — the boardroom-quality control deck for the AHIN gateway.
 *
 * Phase 4 layout:
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  ahin.io                              Gate ⋯ Agents          │  TopBar
 *   │                                                              │
 *   │              ┌──────────────────────┐    ┌──────────────┐   │
 *   │              │ MilestoneButtons     │    │ Protocol     │   │  right column
 *   │              └──────────────────────┘    │ Evidence     │   │  (flex col,
 *   │                                          ├──────────────┤   │   gap-4)
 *   │                                          │ System       │   │
 *   │                  (3D canvas below)       │ Health       │   │
 *   │                                          └──────────────┘   │
 *   │                                                              │
 *   │  ┌────────────┐    ┌──────────────┐    ┌──────────┐         │
 *   │  │ Protocol   │    │  Timeline    │    │  Kill    │         │
 *   │  │ Layers     │    │  scrubber    │    │  Switch  │         │
 *   │  └────────────┘    └──────────────┘    └──────────┘         │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The outer container has `pointer-events-none` so the user can click
 * through to the 3D canvas (OrbitControls owns the rest of the canvas).
 * Each panel restores `pointer-events-auto` on itself.
 */

import { TopBar } from './TopBar';
import { MilestoneButtons } from './MilestoneButtons';
import { Timeline } from './Timeline';
import { KillSwitch } from './KillSwitch';
import { ProtocolLayerStrip } from './ProtocolLayerStrip';
import { ProtocolEvidencePanel } from './ProtocolEvidencePanel';
import { SystemHealth } from './SystemHealth';

export function HudOverlay() {
  return (
    <div className="absolute inset-0 z-10 pointer-events-none select-none">
      <TopBar />
      <MilestoneButtons />
      <ProtocolLayerStrip />
      <Timeline />
      <KillSwitch />

      {/* Right column — telemetry stack. Auto-arranges with flex so the
          two panels stay separated regardless of evidence-stream growth.
          Caps height to leave room for the bottom-row KillSwitch. */}
      <div className="absolute top-24 right-8 bottom-32 z-20 flex flex-col gap-4 overflow-y-auto pointer-events-none">
        <ProtocolEvidencePanel />
        <SystemHealth />
      </div>
    </div>
  );
}
