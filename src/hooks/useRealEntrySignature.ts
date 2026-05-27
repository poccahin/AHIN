"use client";

import { useCallback, useState } from "react";
import { PROTOCOL_EXECUTION_ENABLED, TRANSFER_ENABLED } from "../config/life-plus";
import type { EntryFeeReceipt } from "./useEntrySignature";
import { useEntrySignature as useMockSignature } from "./useEntrySignature";
import type { WalletConnection } from "../lib/walletAdapters";

export function useRealEntrySignature() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const { requestEntry: requestMockEntry } = useMockSignature();

  const requestRealEntry = useCallback(
    async (connectionOrAddress: WalletConnection | string): Promise<EntryFeeReceipt> => {
      const fallbackAddress = typeof connectionOrAddress === "string" ? connectionOrAddress : connectionOrAddress.address;
      setIsProcessing(true);
      setAuthError(null);

      try {
        if (TRANSFER_ENABLED || PROTOCOL_EXECUTION_ENABLED) {
          throw new Error("Protocol execution is disabled for Phase 4E readonly admission.");
        }
        const receipt = await requestMockEntry(fallbackAddress);
        setIsProcessing(false);
        return receipt;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Dry-run entry proof failed.";
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
    protocolExecutionEnabled: false
  };
}
