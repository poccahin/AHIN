"use client";

import { motion } from "framer-motion";
import { FLOW_STEPS, getMatrixAgent, type MatrixAgentId } from "./matrix-elements";

interface AgentFlowRailProps {
  selectedId: MatrixAgentId;
  onSelect: (id: MatrixAgentId) => void;
}

export default function AgentFlowRail({ selectedId, onSelect }: AgentFlowRailProps) {
  return (
    <motion.nav
      className="matrix4f-flow-rail"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.55, duration: 0.64, ease: [0.16, 1, 0.3, 1] }}
      aria-label="Proof and responsibility rail"
    >
      <div className="matrix4f-rail-heading">
        <span>Responsibility Rail</span>
        <small>deterministic dry-run proof path</small>
      </div>
      <div className="matrix4f-flow-scroll">
        {FLOW_STEPS.map((step, index) => {
          const agent = getMatrixAgent(step.agentId);
          const active = selectedId === step.agentId || agent.lastAction === step.action;
          return (
            <button
              key={`${step.action}-${index}`}
              type="button"
              className={`matrix4f-flow-step ${agent.glowClass} ${active ? "is-active" : ""}`}
              onClick={() => onSelect(step.agentId)}
              title={`${agent.enName} · ${step.action} · dry-run`}
            >
              <span className="matrix4f-flow-node" aria-hidden="true" />
              <span className="matrix4f-flow-label">{step.action}</span>
              <small>dry-run</small>
            </button>
          );
        })}
      </div>
    </motion.nav>
  );
}
