import type { GovernanceAgentId } from "./governance-data";
import { RESPONSIBILITY_STEPS, getGovernanceAgent } from "./governance-data";

interface ResponsibilityRailProps {
  selectedAgentId: GovernanceAgentId;
  onSelectAgent: (agentId: GovernanceAgentId) => void;
}

export default function ResponsibilityRail({ selectedAgentId, onSelectAgent }: ResponsibilityRailProps) {
  return (
    <section className="governance-panel responsibility-panel" aria-label="Responsibility rail">
      <div className="governance-section-heading">
        <span>Responsibility rail</span>
        <strong>No real execution</strong>
      </div>
      <div className="responsibility-table-wrap">
        <table className="responsibility-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Action</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {RESPONSIBILITY_STEPS.map((step) => {
              const agent = getGovernanceAgent(step.agentId);
              return (
                <tr key={`${step.index}-${step.action}`} className={selectedAgentId === step.agentId ? "is-selected" : ""} onClick={() => onSelectAgent(step.agentId)}>
                  <td>{step.index}</td>
                  <td>
                    <span className={`responsibility-dot is-${agent.tone}`} aria-hidden="true" />
                    {step.action}
                  </td>
                  <td>{step.mode}</td>
                  <td>
                    <span className={`status-chip is-${step.status}`}>{step.status}</span>
                  </td>
                  <td>{step.duration}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
