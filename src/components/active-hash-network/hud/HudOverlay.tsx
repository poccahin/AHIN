"use client";

import { KillSwitch } from "./KillSwitch";
import { MilestoneButtons } from "./MilestoneButtons";
import { ProtocolLayerStrip } from "./ProtocolLayerStrip";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

export function HudOverlay() {
  return (
    <div className="active-hash-hud" aria-label="AHIN boardroom simulator HUD">
      <TopBar />
      <MilestoneButtons />
      <ProtocolLayerStrip />
      <Timeline />
      <KillSwitch />
    </div>
  );
}
