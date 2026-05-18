"use client";

import { useCallback, useState } from "react";
import { BURN_ENABLED, PROTOCOL_EXECUTION_ENABLED, TRANSFER_ENABLED } from "../config/life-plus";
import type { WalletConnection } from "../lib/walletAdapters";

const ENTRY_DELAY_MS = 1100;

export interface EntryFeeReceipt {
  rail: "evm" | "solana";
  walletId: string;
  payer: string;
  recipient: string;
  asset: "LIFE++";
  amount: "1";
  signature: string;
  confirmed: boolean;
  confirmedAt: string;
}

export interface EntrySignatureState {
  charging: boolean;
  isProcessing: boolean;
  receipt: EntryFeeReceipt | null;
  authError: string | null;
  error: string | null;
}

const initialState: EntrySignatureState = {
  charging: false,
  isProcessing: false,
  receipt: null,
  authError: null,
  error: null
};

function assertMockGate() {
  if (TRANSFER_ENABLED || BURN_ENABLED || PROTOCOL_EXECUTION_ENABLED) {
    throw new Error("Protocol execution is disabled for Phase 4E readonly admission.");
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function mockReceipt(walletAddress: string, walletId = "readonly_wallet", rail: EntryFeeReceipt["rail"] = "solana"): EntryFeeReceipt {
  const confirmedAt = new Date().toISOString();
  return {
    rail,
    walletId,
    payer: walletAddress,
    recipient: "AbzDBaC9AmG4ve1Jfemi5TFPCGLLcurqzwPaHj9Jidzr",
    asset: "LIFE++",
    amount: "1",
    signature: `dry-run-lifepp-entry-${Date.now().toString(36)}`,
    confirmed: true,
    confirmedAt
  };
}

export function useEntrySignature() {
  const [state, setState] = useState<EntrySignatureState>(initialState);

  const requestEntry = useCallback(async (walletAddress: string) => {
    setState({ charging: true, isProcessing: true, receipt: null, authError: null, error: null });
    try {
      assertMockGate();
      await delay(ENTRY_DELAY_MS);
      const receipt = mockReceipt(walletAddress);
      setState({ charging: false, isProcessing: false, receipt, authError: null, error: null });
      return receipt;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Readonly entry authorization failed.";
      setState({ charging: false, isProcessing: false, receipt: null, authError: message, error: message });
      throw new Error(message);
    }
  }, []);

  const chargeEntryFee = useCallback(async (connection: WalletConnection) => {
    setState({ charging: true, isProcessing: true, receipt: null, authError: null, error: null });
    try {
      assertMockGate();
      await delay(ENTRY_DELAY_MS);
      const receipt = mockReceipt(connection.address, connection.id, connection.rail);
      setState({ charging: false, isProcessing: false, receipt, authError: null, error: null });
      return receipt;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Readonly entry authorization failed.";
      setState({ charging: false, isProcessing: false, receipt: null, authError: message, error: message });
      throw new Error(message);
    }
  }, []);

  const reset = useCallback(() => setState(initialState), []);

  return {
    ...state,
    requestEntry,
    chargeEntryFee,
    reset
  };
}
