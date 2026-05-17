"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import AgentEntity from "./AgentEntity";
import AgentFlowRail from "./AgentFlowRail";
import AgentInspector from "./AgentInspector";
import MatrixHeader from "./MatrixHeader";
import ProofEnvelopeModal from "./ProofEnvelopeModal";
import { CENTER_AGENT_ID, MATRIX_AGENTS, getMatrixAgent, type MatrixAgentId } from "./matrix-elements";
import { agentContainerVariants, sceneVariants } from "./matrix-motion";

const MATRIX_DISCLOSURE = "Readonly / mock verification only · No LIFE++ transferred or burned · Protocol execution disabled";

export default function AgentMatrixScene() {
  const [selectedId, setSelectedId] = useState<MatrixAgentId>(CENTER_AGENT_ID);
  const [proofOpen, setProofOpen] = useState(false);
  const selectedAgent = useMemo(() => getMatrixAgent(selectedId), [selectedId]);

  return (
    <motion.section
      className="matrix4f-scene"
      variants={sceneVariants}
      initial="hidden"
      animate="visible"
      aria-label="AHIN Agent Matrix Command Deck"
    >
      <div className="matrix4f-background" aria-hidden="true">
        <span className="matrix4f-glow is-orange" />
        <span className="matrix4f-glow is-purple" />
        <span className="matrix4f-glow is-blue" />
        <span className="matrix4f-glow is-gold" />
        <span className="matrix4f-glow is-green" />
        <span className="matrix4f-mist" />
        <span className="matrix4f-grid" />
        <span className="matrix4f-coordinate-lines" />
        <span className="matrix4f-floating-particles" />
      </div>

      <div className="matrix4f-shell">
        <MatrixHeader />

        <div className="matrix4f-command-area">
          <motion.div className="matrix4f-stage" variants={agentContainerVariants} initial="hidden" animate="visible">
            <span className="matrix4f-orbit is-outer" aria-hidden="true" />
            <span className="matrix4f-orbit is-middle" aria-hidden="true" />
            <span className="matrix4f-orbit is-inner" aria-hidden="true" />
            <span className="matrix4f-proof-pulse" aria-hidden="true" />
            <span className="matrix4f-flow-line is-one" aria-hidden="true" />
            <span className="matrix4f-flow-line is-two" aria-hidden="true" />
            <span className="matrix4f-flow-line is-three" aria-hidden="true" />
            <span className="matrix4f-flow-line is-four" aria-hidden="true" />
            {MATRIX_AGENTS.map((agent) => (
              <AgentEntity key={agent.id} agent={agent} selected={selectedId === agent.id} onSelect={setSelectedId} />
            ))}
          </motion.div>

          <AgentInspector agent={selectedAgent} onViewProof={() => setProofOpen(true)} />
        </div>

        <div className="matrix4f-mobile-selector" aria-label="Agent selector">
          {MATRIX_AGENTS.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`${agent.glowClass} ${selectedId === agent.id ? "is-selected" : ""}`}
              onClick={() => setSelectedId(agent.id)}
            >
              <span aria-hidden="true" />
              {agent.cnName}
            </button>
          ))}
        </div>

        <AgentFlowRail selectedId={selectedId} onSelect={setSelectedId} />

        <footer className="matrix4f-disclosure">{MATRIX_DISCLOSURE}</footer>
      </div>

      <ProofEnvelopeModal agent={selectedAgent} open={proofOpen} onClose={() => setProofOpen(false)} />
    </motion.section>
  );
}
