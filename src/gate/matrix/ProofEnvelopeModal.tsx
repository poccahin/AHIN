"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { MatrixAgent } from "./matrix-elements";
import { modalPanelVariants, modalVariants } from "./matrix-motion";

interface ProofEnvelopeModalProps {
  agent: MatrixAgent;
  open: boolean;
  onClose: () => void;
}

function dryRunHash(prefix: string, value: string) {
  const encoded = Array.from(value)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24)
    .padEnd(24, "0");
  return `${prefix}-${encoded}`;
}

export default function ProofEnvelopeModal({ agent, open, onClose }: ProofEnvelopeModalProps) {
  const envelope = {
    envelopeId: `ahin-proof-${agent.id}`,
    agentId: agent.id,
    action: agent.lastAction,
    inputHash: dryRunHash("in", `${agent.id}:${agent.lastAction}`),
    outputHash: dryRunHash("out", `${agent.ahinAnchor}:${agent.mode}`),
    previousEnvelopeHash: dryRunHash("prev", agent.ahinAnchor),
    mode: "dry_run",
    protocolExecutionEnabled: false,
    realWalletTransfer: false,
    realBurnTransaction: false
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="matrix4f-modal" variants={modalVariants} initial="hidden" animate="visible" exit="exit" role="dialog" aria-modal="true">
          <button type="button" className="matrix4f-modal-scrim" aria-label="Close proof envelope" onClick={onClose} />
          <motion.div className="matrix4f-modal-panel" variants={modalPanelVariants}>
            <div className="matrix4f-modal-header">
              <div>
                <p>Dry-run Proof Envelope</p>
                <h2>{agent.enName}</h2>
              </div>
              <button type="button" className="matrix4f-modal-close" onClick={onClose} aria-label="Close proof envelope">
                <X className="h-4 w-4" aria-hidden={true} />
              </button>
            </div>
            <dl className="matrix4f-proof-grid">
              {Object.entries(envelope).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
            <p className="matrix4f-modal-note">
              Local dry-run only · No chain call · No signing · No LIFE++ transferred or burned
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
