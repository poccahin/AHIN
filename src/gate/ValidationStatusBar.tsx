"use client";

import { motion } from "framer-motion";
import type { GateState } from "./AhinGateScene";

interface ValidationStatusBarProps {
  state: GateState;
  walletLabel: string | null;
}

function assetLabel(state: GateState) {
  if (state === "idle" || state === "wallet_selecting") {
    return "Awaiting readonly proof";
  }
  if (state === "wallet_connected") {
    return "Wallet linked";
  }
  if (state === "asset_checking") {
    return "Checking LIFE++ holding";
  }
  return "Readonly LIFE++ holding ready";
}

export default function ValidationStatusBar({ state, walletLabel }: ValidationStatusBarProps) {
  const secure = true;

  return (
    <div className="validation-status-bar">
      <div className="validation-row">
        <span className={secure ? "secure-dot is-live" : "secure-dot"} aria-hidden="true" />
        <span>Zero-Trust Tunnel: Secure</span>
      </div>
      <motion.div
        className="validation-row justify-between"
        animate={{ opacity: walletLabel ? 1 : 0.72 }}
        transition={{ duration: 0.28 }}
      >
        <span>{walletLabel ? `${walletLabel} connected` : "Wallet session unbound"}</span>
        <strong>{assetLabel(state)}</strong>
      </motion.div>
    </div>
  );
}
