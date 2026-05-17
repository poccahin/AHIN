"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import AmbientParticles from "./AmbientParticles";
import GateCard from "./GateCard";
import MatrixReveal from "./MatrixReveal";
import type { WalletOption } from "./WalletButton";
import { MOCK_FALLBACK_STATES, type MockFallbackState } from "./wallet/mock-fallback";
import { mapWalletProviderError } from "./wallet/wallet-errors";

export type GateState =
  | "idle"
  | "wallet_selecting"
  | "wallet_connected"
  | "asset_checking"
  | "asset_verified"
  | "signature_pending"
  | "signature_verified"
  | "matrix_revealing"
  | "matrix_active"
  | MockFallbackState;

const MATRIX_STATES: GateState[] = ["matrix_revealing", "matrix_active"];

export default function AhinGateScene() {
  const debugMatrix = process.env.NEXT_PUBLIC_AHIN_DEBUG_MATRIX === "true";
  const [gateState, setGateState] = useState<GateState>(() => (debugMatrix ? "matrix_active" : "idle"));
  const [selectedWallet, setSelectedWallet] = useState<WalletOption | null>(null);
  const [walletWarning, setWalletWarning] = useState<string | null>(null);
  const timeouts = useRef<number[]>([]);

  function queue(callback: () => void, delay: number) {
    const id = window.setTimeout(callback, delay);
    timeouts.current.push(id);
  }

  useEffect(() => {
    return () => {
      timeouts.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  function clearTimeline() {
    timeouts.current.forEach((id) => window.clearTimeout(id));
    timeouts.current = [];
  }

  function handleWalletSelect(wallet: WalletOption) {
    clearTimeline();
    setWalletWarning(null);
    setSelectedWallet(wallet);
    setGateState("wallet_selecting");
    queue(() => setGateState("wallet_connected"), 420);
    queue(() => setGateState("asset_checking"), 820);
    queue(() => setGateState("asset_verified"), 1420);
  }

  function handleMockFallback() {
    clearTimeline();
    setWalletWarning(null);
    setSelectedWallet({ id: "phantom", label: "Mock Wallet", rail: "SVM" });
    MOCK_FALLBACK_STATES.forEach((state, index) => queue(() => setGateState(state), index * 260));
  }

  function handleSignatureRequest() {
    if (gateState !== "asset_verified" && gateState !== "signature_verified") {
      return;
    }
    clearTimeline();
    setGateState("signature_pending");
    queue(() => setGateState("signature_verified"), 1180);
    queue(() => setGateState("matrix_revealing"), 1880);
    queue(() => setGateState("matrix_active"), 3050);
  }

  const matrixVisible = MATRIX_STATES.includes(gateState);

  return (
    <main className="ahin-gate-scene fixed inset-0 overflow-hidden bg-[#050505] text-white">
      <AmbientParticles />
      <div className="living-light-field" aria-hidden="true" />
      <div className="gate-depth-grid" aria-hidden="true" />
      <AnimatePresence>{gateState === "matrix_revealing" ? <motion.div className="gate-dissolve-burst" aria-hidden="true" exit={{ opacity: 0 }} /> : null}</AnimatePresence>

      <AnimatePresence mode="wait">
        {!matrixVisible ? (
          <motion.div
            key="gate"
            className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10"
            initial={{ opacity: 0, scale: 1.015 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <GateCard
              state={gateState}
              selectedWallet={selectedWallet}
              onWalletSelect={(wallet) => {
                try {
                  handleWalletSelect(wallet);
                } catch (error) {
                  setWalletWarning(mapWalletProviderError(error).message);
                }
              }}
              onSignatureRequest={handleSignatureRequest}
              onMockFallback={handleMockFallback}
              walletWarning={walletWarning}
            />
          </motion.div>
        ) : (
          <MatrixReveal key="matrix" />
        )}
      </AnimatePresence>
    </main>
  );
}
