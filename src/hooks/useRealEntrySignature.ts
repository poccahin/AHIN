"use client";

import { useCallback, useState } from "react";
import { PROTOCOL_EXECUTION_ENABLED, TRANSFER_ENABLED } from "../config/life-plus";
import type { EntryFeeReceipt } from "./useEntrySignature";
import { useEntrySignature as useMockSignature } from "./useEntrySignature";
import { useAuthStore } from "../store/authStore";
import type { WalletConnection, WalletId } from "../lib/walletAdapters";

/** PoCC Squads multisig treasury — destination for live entry fees. */
const POCC_TREASURY_ADDRESS = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";

/**
 * Heuristic to detect mock/dry-run signatures that should NOT be treated
 * as live cryptographic proof. The mock paths in useEntrySignature and
 * createMockSession both emit prefixed strings (`mock-…`, `dry-run-…`).
 */
function isMockSignature(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return true;
  return value.startsWith("mock-") || value.startsWith("dry-run-");
}

export function useRealEntrySignature() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const { requestEntry: requestMockEntry } = useMockSignature();
  // Read auth state via the store directly (.getState() inside the
  // callback) so we always see the latest signature without re-rendering
  // the consumer when session changes.

  const requestRealEntry = useCallback(
    async (
      connectionOrAddress: WalletConnection | string
    ): Promise<EntryFeeReceipt> => {
      const isStringInput = typeof connectionOrAddress === "string";
      const fallbackAddress = isStringInput
        ? connectionOrAddress
        : connectionOrAddress.address;
      const walletId: WalletId = isStringInput
        ? "phantom_solana"
        : connectionOrAddress.id;
      const rail: EntryFeeReceipt["rail"] = isStringInput
        ? "solana"
        : connectionOrAddress.rail;

      setIsProcessing(true);
      setAuthError(null);

      try {
        const { gateMode, session } = useAuthStore.getState();

        // -- LIVE branch ------------------------------------------------
        // The user entered via LifePaymentModule, which called
        // grantAccess(wallet, signature). That signature now lives on
        // session.entryFee.signature. We construct an EntryFeeReceipt
        // around it; we do NOT fall back to the mock path here.
        if (gateMode === "live") {
          const liveSignature = session?.entryFee.signature ?? null;
          if (!liveSignature || isMockSignature(liveSignature)) {
            throw new Error(
              "No live entry signature in session — LifePaymentModule must complete an on-chain transfer first."
            );
          }
          const receipt: EntryFeeReceipt = {
            rail,
            walletId,
            payer: fallbackAddress,
            recipient: POCC_TREASURY_ADDRESS,
            asset: "LIFE++",
            amount: "1",
            signature: liveSignature,
            confirmed: true,
            confirmedAt:
              session?.entryFee.confirmedAt ?? new Date().toISOString()
          };
          setIsProcessing(false);
          return receipt;
        }

        // -- MOCK branch ------------------------------------------------
        // Defensive guard preserved: if real-mode flags are armed but
        // gateMode somehow landed on "mock", something is misconfigured.
        if (TRANSFER_ENABLED || PROTOCOL_EXECUTION_ENABLED) {
          throw new Error(
            "Protocol execution is disabled for Phase 4E readonly admission."
          );
        }
        const receipt = await requestMockEntry(fallbackAddress);
        setIsProcessing(false);
        return receipt;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Entry proof failed.";
        setAuthError(message);
        setIsProcessing(false);
        throw new Error(message);
      }
    },
    [requestMockEntry]
  );

  return {
    requestRealEntry,
    isProcessing,
    authError,
    protocolExecutionEnabled: PROTOCOL_EXECUTION_ENABLED
  };
}
