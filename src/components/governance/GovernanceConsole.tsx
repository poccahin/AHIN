"use client";

import { useState } from "react";
import FiveAgentTopology from "./FiveAgentTopology";
import GovernanceFooter from "./GovernanceFooter";
import GovernanceInspector from "./GovernanceInspector";
import GovernancePhaseStrip from "./GovernancePhaseStrip";
import GovernanceTopBar from "./GovernanceTopBar";
import ResponsibilityRail from "./ResponsibilityRail";
import TreasuryCustodyCard from "./TreasuryCustodyCard";
import type { GovernanceAgentId } from "./governance-data";

export default function GovernanceConsole() {
  const [selectedAgentId, setSelectedAgentId] = useState<GovernanceAgentId>("currents");

  return (
    <main className="governance-console" aria-label="AHIN Governance Console">
      <div className="governance-shell">
        <GovernanceTopBar />
        <GovernancePhaseStrip />

        <div className="governance-grid">
          <div className="governance-main-stack">
            <FiveAgentTopology selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
            <ResponsibilityRail selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
          </div>
          <div className="governance-side-stack">
            <TreasuryCustodyCard />
            <GovernanceInspector selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
          </div>
        </div>

        <GovernanceFooter />
      </div>
    </main>
  );
}
