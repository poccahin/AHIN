"use client";

import { useMemo, useState } from "react";
import type { GovernanceAgentId } from "./governance-data";
import { INSPECTOR_AGENT_ORDER, getGovernanceAgent } from "./governance-data";

interface GovernanceInspectorProps {
  selectedAgentId: GovernanceAgentId;
  onSelectAgent: (agentId: GovernanceAgentId) => void;
}

export default function GovernanceInspector({ selectedAgentId, onSelectAgent }: GovernanceInspectorProps) {
  const [proofOpen, setProofOpen] = useState(false);
  const selectedAgent = useMemo(() => getGovernanceAgent(selectedAgentId), [selectedAgentId]);
  const proofEnvelope = {
    envelopeId: `ahin-g1-proof-${selectedAgent.id}`,
    agentId: selectedAgent.id,
    action: selectedAgent.action,
    mode: "dry_run_readonly",
    protocolExecutionEnabled: false,
    realWalletTransfer: false,
    realBurnTransaction: false,
    signingEnabled: false,
    transactionSubmissionEnabled: false,
    signatureRequestGenerated: false
  };

  return (
    <aside className="governance-panel governance-inspector" aria-label="Governance inspector">
      <div className="governance-section-heading">
        <span>Governance Inspector</span>
        <strong>Agent switcher</strong>
      </div>

      <div className="agent-switcher" role="tablist" aria-label="Governance agent switcher">
        {INSPECTOR_AGENT_ORDER.map((agentId) => {
          const agent = getGovernanceAgent(agentId);
          return (
            <button
              key={agent.id}
              type="button"
              role="tab"
              aria-selected={selectedAgentId === agent.id}
              className={`agent-switch is-${agent.tone} ${selectedAgentId === agent.id ? "is-selected" : ""}`}
              onClick={() => onSelectAgent(agent.id)}
            >
              {agent.glyph}
            </button>
          );
        })}
      </div>

      <div className={`selected-agent-card is-${selectedAgent.tone}`}>
        <span className="selected-agent-glyph">{selectedAgent.glyph}</span>
        <div>
          <p>{selectedAgent.cnName}</p>
          <h2>{selectedAgent.name}</h2>
          <span>{selectedAgent.subtitle}</span>
        </div>
      </div>

      <p className="selected-agent-description">{selectedAgent.description}</p>

      <dl className="inspector-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`status-chip is-${selectedAgent.status}`}>{selectedAgent.statusLabel}</span>
          </dd>
        </div>
        <div>
          <dt>Consensus</dt>
          <dd>PoCC verified</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>Dry-run · readonly</dd>
        </div>
        <div>
          <dt>Risk / Proof</dt>
          <dd>Passed · dry-run evidence</dd>
        </div>
        <div>
          <dt>AHIN anchor</dt>
          <dd>{selectedAgent.ahinAnchor}</dd>
        </div>
        <div>
          <dt>Last action</dt>
          <dd>{selectedAgent.action}</dd>
        </div>
        <div>
          <dt>Treasury</dt>
          <dd>Blocked</dd>
        </div>
        <div>
          <dt>Execution</dt>
          <dd>Disabled</dd>
        </div>
        <div>
          <dt>Oracle</dt>
          <dd>Readonly</dd>
        </div>
        <div>
          <dt>Burn</dt>
          <dd>Disabled</dd>
        </div>
        <div>
          <dt>Signing</dt>
          <dd>Disabled</dd>
        </div>
        <div>
          <dt>Transaction submission</dt>
          <dd>Disabled</dd>
        </div>
      </dl>

      <button type="button" className="proof-envelope-button" onClick={() => setProofOpen(true)}>
        Open certificate terminal
      </button>

      {proofOpen ? (
        <div className="governance-modal" role="dialog" aria-modal="true" aria-label="Readonly evidence certificate terminal">
          <button type="button" className="governance-modal-scrim" aria-label="Close certificate terminal" onClick={() => setProofOpen(false)} />
          <div className="governance-modal-panel">
            <div>
              <p>Certificate Payload Terminal</p>
              <h2>{selectedAgent.name}</h2>
            </div>
            <pre>{JSON.stringify(proofEnvelope, null, 2)}</pre>
            <p>No network call · No chain call · no signature request generated · No LIFE++ transferred or burned</p>
            <button type="button" onClick={() => setProofOpen(false)}>
              Close terminal
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
