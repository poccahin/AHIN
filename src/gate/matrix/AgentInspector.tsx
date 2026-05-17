"use client";

import { motion } from "framer-motion";
import { FileSearch, Sparkles } from "lucide-react";
import type { MatrixAgent } from "./matrix-elements";
import { inspectorVariants } from "./matrix-motion";

interface AgentInspectorProps {
  agent: MatrixAgent;
  onViewProof: () => void;
}

export default function AgentInspector({ agent, onViewProof }: AgentInspectorProps) {
  return (
    <motion.aside className={`matrix4f-inspector ${agent.glowClass}`} variants={inspectorVariants} initial="hidden" animate="visible">
      <div className="matrix4f-inspector-top">
        <div>
          <p>Governance Inspector</p>
          <h2>{agent.enName}</h2>
        </div>
        <span className="matrix4f-live-pill">
          <Sparkles className="h-3.5 w-3.5" aria-hidden={true} />
          Active
        </span>
      </div>
      <p className="matrix4f-selected-agent">Selected Agent · {agent.cnName}</p>
      <p className="matrix4f-inspector-role">{agent.role}</p>
      <p className="matrix4f-inspector-description">{agent.description}</p>
      <dl className="matrix4f-inspector-list">
        <div>
          <dt>Status</dt>
          <dd>{agent.status}</dd>
        </div>
        <div>
          <dt>Consensus Route</dt>
          <dd>{agent.consensusRoute}</dd>
        </div>
        <div>
          <dt>AHIN Anchor</dt>
          <dd>{agent.ahinAnchor}</dd>
        </div>
        <div>
          <dt>Current Mode</dt>
          <dd>{agent.mode}</dd>
        </div>
        <div>
          <dt>Last Action</dt>
          <dd>{agent.lastAction}</dd>
        </div>
        <div>
          <dt>Risk / Proof</dt>
          <dd>{agent.proofStatus}</dd>
        </div>
        <div>
          <dt>Treasury Funding</dt>
          <dd>Blocked</dd>
        </div>
        <div>
          <dt>Execution Authority</dt>
          <dd>Disabled</dd>
        </div>
      </dl>
      <button type="button" className="matrix4f-proof-button" onClick={onViewProof}>
        <FileSearch className="h-4 w-4" aria-hidden={true} />
        View Proof Envelope
      </button>
    </motion.aside>
  );
}
