"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { LIFE_PLUS_MINT } from "../config/life-plus";
import ConfirmationRing from "./ConfirmationRing";
import ValidationStatusBar from "./ValidationStatusBar";
import WalletButton, { type WalletOption } from "./WalletButton";
import { detectWalletProviders } from "./wallet/wallet-detection";
import { MOCK_FALLBACK_DISCLOSURE } from "./wallet/mock-fallback";
import { gateCardVariants } from "./motion";
import type { GateState } from "./AhinGateScene";

const WALLETS: WalletOption[] = [
  { id: "phantom", label: "Phantom", rail: "SVM" },
  { id: "okx", label: "OKX", rail: "SVM" },
  { id: "binance", label: "Binance", rail: "EVM" },
  { id: "metamask", label: "MetaMask", rail: "EVM" }
];
const LIFE_PLUS_MINT_SHORT = `${LIFE_PLUS_MINT.slice(0, 5)}...${LIFE_PLUS_MINT.slice(-4)}`;

interface GateCardProps {
  state: GateState;
  selectedWallet: WalletOption | null;
  onWalletSelect: (wallet: WalletOption) => void;
  onSignatureRequest: () => void;
  onMockFallback: () => void;
  walletWarning?: string | null;
}

function canBurn(state: GateState) {
  return state === "asset_verified" || state === "signature_verified";
}

export default function GateCard({ state, selectedWallet, onWalletSelect, onSignatureRequest, onMockFallback, walletWarning = null }: GateCardProps) {
  const gateMode = process.env.NEXT_PUBLIC_AHIN_GATE_MODE ?? process.env.NEXT_PUBLIC_AHIN_WALLET_MODE ?? "mock";
  const assetReady = state === "asset_verified" || state === "signature_pending" || state === "signature_verified";
  const pending = state === "signature_pending";
  const detection = detectWalletProviders();

  return (
    <motion.section
      className="ahin-glass-card relative z-20 w-[min(92vw,520px)] overflow-hidden px-6 py-7 shadow-glass sm:px-8 sm:py-8"
      variants={gateCardVariants}
      initial="visible"
      animate="visible"
      exit="exit"
      aria-label="ahin.io zero-trust gate"
    >
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.55] to-transparent" />
      <div className="relative">
        <div className="mb-8 flex items-start justify-between gap-5">
          <div>
            <motion.p
              className="mb-2 text-[11px] uppercase text-white/[0.38]"
              animate={{ opacity: [0.55, 0.9, 0.55] }}
              transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
            >
              Multi-Agent Zero-Trust Network
            </motion.p>
            <h1 className="text-[48px] font-semibold leading-none text-white sm:text-[64px]">ahin.io</h1>
          </div>
          <div className="gate-seal" aria-hidden="true">
            <ShieldCheck className="h-5 w-5" />
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2.5">
          {WALLETS.map((wallet) => (
            <WalletButton
              key={wallet.id}
              wallet={wallet}
              selected={selectedWallet?.id === wallet.id}
              detectionStatus={detection.find((candidate) => candidate.id === wallet.id)?.status}
              disabled={pending || detection.find((candidate) => candidate.id === wallet.id)?.status === "not_detected"}
              onSelect={onWalletSelect}
            />
          ))}
        </div>

        {walletWarning ? <p className="mb-4 rounded-2xl border border-amber-200/15 bg-amber-100/[0.07] px-4 py-3 text-xs leading-5 text-amber-100">{walletWarning}</p> : null}

        <ValidationStatusBar state={state} walletLabel={selectedWallet?.label ?? null} />

        <AnimatePresence mode="popLayout">
          {assetReady ? (
            <div className="mt-6 flex items-center justify-between gap-5">
              <div className="min-w-0">
                <p className="text-[12px] uppercase text-white/[0.38]">Proof of Assets</p>
                <p className="mt-1 text-sm text-white/[0.82]">Readonly LIFE++ holding proof ready</p>
                <div className="mt-2 grid gap-1 text-xs leading-5 text-white/[0.42]">
                  <p>Admission threshold: ≥ 10 USDT-equivalent LIFE++</p>
                  <p>LIFE++ mint: {LIFE_PLUS_MINT_SHORT}</p>
                  <p>Quote source: Jupiter readonly</p>
                  <p>No transfer or burn will be executed</p>
                </div>
              </div>
              <ConfirmationRing state={state} visible={assetReady} />
            </div>
          ) : null}
        </AnimatePresence>

        <motion.button
          type="button"
          className="dry-run-button mt-7"
          disabled={!canBurn(state)}
          onClick={onSignatureRequest}
          whileHover={canBurn(state) ? { y: -2, scale: 1.01 } : undefined}
          whileTap={canBurn(state) ? { scale: 0.985 } : undefined}
        >
          <span>{pending ? "Dry-Run Proof Pending" : "Enter with Dry-Run Proof"}</span>
          <ChevronRight aria-hidden="true" />
        </motion.button>
        {gateMode === "mock" ? (
          <div className="mt-5 space-y-3">
            <button type="button" className="wallet-glass-button w-full justify-center" onClick={onMockFallback}>
              Continue with Mock Verification
            </button>
            <p className="mock-mode-disclosure">{MOCK_FALLBACK_DISCLOSURE}</p>
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}
