import type { GovernanceAgentId } from "./governance-data";
import { GOVERNANCE_AGENTS } from "./governance-data";

interface FiveAgentTopologyProps {
  selectedAgentId: GovernanceAgentId;
  onSelectAgent: (agentId: GovernanceAgentId) => void;
}

export default function FiveAgentTopology({ selectedAgentId, onSelectAgent }: FiveAgentTopologyProps) {
  return (
    <section className="governance-panel topology-panel" aria-label="Five-agent responsibility topology">
      <div className="governance-section-heading">
        <span>Five-agent responsibility topology</span>
        <strong>Dry-run consensus field</strong>
      </div>
      <div className="topology-map">
        <div className="topology-path is-horizontal" aria-hidden="true" />
        <div className="topology-path is-vertical" aria-hidden="true" />
        {GOVERNANCE_AGENTS.map((agent) => (
          <button
            key={agent.id}
            type="button"
            className={`topology-node is-${agent.tone} ${selectedAgentId === agent.id ? "is-selected" : ""}`}
            onClick={() => onSelectAgent(agent.id)}
            aria-pressed={selectedAgentId === agent.id}
          >
            <span className="topology-node-index">{agent.index}</span>
            <span className="topology-node-glyph">{agent.glyph}</span>
            <span className="topology-node-copy">
              <strong>{agent.action}</strong>
              <small>{agent.cnName}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
