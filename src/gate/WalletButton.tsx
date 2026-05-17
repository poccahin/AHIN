"use client";

import { motion } from "framer-motion";
import type { WalletDetectionStatus } from "./wallet/wallet-detection";

export interface WalletOption {
  id: "phantom" | "okx" | "binance" | "metamask";
  label: string;
  rail: "SVM" | "EVM";
}

interface WalletButtonProps {
  wallet: WalletOption;
  selected: boolean;
  disabled?: boolean;
  detectionStatus?: WalletDetectionStatus;
  onSelect: (wallet: WalletOption) => void;
}

function statusLabel(status?: WalletDetectionStatus) {
  if (status === "not_detected") return "Not detected";
  if (status === "provider_conflict") return "Conflict";
  if (status === "browser_unsupported") return "Unsupported";
  return walletRailLabel(status);
}

function walletRailLabel(status?: WalletDetectionStatus) {
  return status === "available" ? "Available" : "";
}

export default function WalletButton({ wallet, selected, disabled = false, detectionStatus, onSelect }: WalletButtonProps) {
  const detail = statusLabel(detectionStatus) || wallet.rail;

  return (
    <motion.button
      type="button"
      className={`wallet-glass-button ${selected ? "is-selected" : ""}`}
      disabled={disabled}
      onClick={() => onSelect(wallet)}
      whileHover={disabled ? undefined : { y: -2, scale: 1.015 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      aria-pressed={selected}
    >
      <span className="wallet-mark" aria-hidden="true">
        {wallet.label.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-white/[0.88]">{wallet.label}</span>
        <span className={`block text-[10px] uppercase ${detectionStatus === "available" || !detectionStatus ? "text-white/[0.38]" : "text-amber-200/70"}`}>
          {detail}
        </span>
      </span>
    </motion.button>
  );
}
