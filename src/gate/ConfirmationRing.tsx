"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";
import type { GateState } from "./AhinGateScene";

interface ConfirmationRingProps {
  state: GateState;
  visible: boolean;
}

function progressForState(state: GateState) {
  if (state === "signature_pending") {
    return 72;
  }
  if (state === "asset_verified") {
    return 44;
  }
  if (state === "signature_verified" || state === "matrix_revealing" || state === "matrix_active") {
    return 100;
  }
  return 28;
}

export default function ConfirmationRing({ state, visible }: ConfirmationRingProps) {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const progress = progressForState(state);
  const offset = circumference - (progress / 100) * circumference;
  const verified = progress === 100;

  if (!visible) {
    return null;
  }

  return (
    <motion.div
      className="confirmation-ring-shell"
      initial={{ opacity: 0, scale: 0.86, filter: "blur(12px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.94, filter: "blur(14px)" }}
      transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
      aria-label={verified ? "Signature verified" : "Signature confirmation pending"}
    >
      <svg className="confirmation-ring" viewBox="0 0 112 112" aria-hidden="true">
        <circle className="confirmation-ring-track" cx="56" cy="56" r={radius} />
        <motion.circle
          className="confirmation-ring-progress"
          cx="56"
          cy="56"
          r={radius}
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: state === "signature_pending" ? 1.2 : 0.42, ease: "easeInOut" }}
        />
      </svg>
      <div className="confirmation-ring-core">
        {verified ? <Check aria-hidden="true" /> : <span>{progress}</span>}
      </div>
    </motion.div>
  );
}
