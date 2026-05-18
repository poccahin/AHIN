import type { GovernanceAgentId } from "./governance-data";
import { GOVERNANCE_AGENTS } from "./governance-data";

interface FiveAgentTopologyProps {
  selectedAgentId: GovernanceAgentId;
  onSelectAgent: (agentId: GovernanceAgentId) => void;
}

export default function FiveAgentTopology({ selectedAgentId, onSelectAgent }: FiveAgentTopologyProps) {
  return (
    <section className="governance-panel topology-panel" aria-label="Agent state matrix">
      <div className="governance-section-heading">
        <span>Agent State Matrix</span>
        <strong>Readonly responsibility rails</strong>
      </div>
      <div className="agent-state-table-wrap">
        <table className="terminal-table agent-state-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Agent</th>
              <th>Action</th>
              <th>Mode</th>
              <th>Heartbeat</th>
              <th>Status</th>
              <th>Last hash</th>
            </tr>
          </thead>
          <tbody>
            {GOVERNANCE_AGENTS.map((agent) => (
              <tr key={agent.id} className={`is-${agent.tone} ${selectedAgentId === agent.id ? "is-selected" : ""}`} onClick={() => onSelectAgent(agent.id)}>
                <td>{agent.index}</td>
                <td>
                  <button type="button" onClick={() => onSelectAgent(agent.id)} aria-pressed={selectedAgentId === agent.id}>
                    <span className="terminal-dot" aria-hidden="true" />
                    {agent.name}
                    <small>{agent.cnName}</small>
                  </button>
                </td>
                <td>{agent.action}</td>
                <td>{agent.id === "currents" ? "readonly" : "dry-run"}</td>
                <td>{agent.heartbeat}</td>
                <td>
                  <span className={`status-chip is-${agent.status}`}>{agent.statusLabel}</span>
                </td>
                <td>{agent.lastHash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
