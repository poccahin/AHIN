"use client";

import { useState } from "react";
import FiveAgentTopology from "./FiveAgentTopology";
import GovernanceFooter from "./GovernanceFooter";
import GovernanceInspector from "./GovernanceInspector";
import GovernancePhaseStrip from "./GovernancePhaseStrip";
import GovernanceTopBar from "./GovernanceTopBar";
import ResponsibilityRail from "./ResponsibilityRail";
import TreasuryCustodyCard from "./TreasuryCustodyCard";
import TrustedTwinCourt from "../trusted-twin/TrustedTwinCourt";
import { COGNITIVE_HASH_STREAM } from "./governance-data";
import type { GovernanceAgentId } from "./governance-data";

export default function GovernanceConsole() {
  const [selectedAgentId, setSelectedAgentId] = useState<GovernanceAgentId>("currents");

  return (
    <main className="governance-console" aria-label="AHIN Governance Terminal">
      <div className="governance-shell">
        <GovernanceTopBar />
        <GovernancePhaseStrip />

        <div className="terminal-grid">
          <div className="terminal-left-stack">
            <FiveAgentTopology selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
            <ResponsibilityRail selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
          </div>
          <div className="terminal-center-stack">
            <TreasuryCustodyCard />
            <TrustedTwinCourt />
          </div>
          <div className="terminal-right-stack">
            <section className="governance-panel hash-stream-panel" aria-label="Cognitive hash stream">
              <div className="governance-section-heading">
                <span>Cognitive Hash Stream</span>
                <strong>Readonly evidence tail</strong>
              </div>
              <div className="hash-stream">
                {COGNITIVE_HASH_STREAM.map((event) => (
                  <div key={`${event.authority}-${event.hash}`} className="hash-stream-row">
                    <span>{event.timestamp}</span>
                    <span>{event.authority}</span>
                    <span>{event.event}</span>
                    <span>{event.hash}</span>
                    <strong>{event.status}</strong>
                  </div>
                ))}
              </div>
            </section>
            <GovernanceInspector selectedAgentId={selectedAgentId} onSelectAgent={setSelectedAgentId} />
          </div>
        </div>

        <GovernanceFooter />
      </div>
    </main>
  );
}
