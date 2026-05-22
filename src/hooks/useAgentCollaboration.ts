"use client";

import { useCallback, useState } from "react";
import {
  AHIN_COLLABORATION_USAGE_RULE,
  LIFE_PLUS_MINT,
  PROTOCOL_EXECUTION_ENABLED,
  TRANSFER_ENABLED,
  BURN_ENABLED
} from "../config/life-plus";
import { calculateCollaborationFee } from "../services/poccConsensus";
import { getAssociatedTokenAddress, getLifePlusMint, readLifePlusDecimals } from "../lib/lifePlusSolana";
import type { WalletConnection } from "../lib/walletAdapters";

export interface AgentCollaborationDryRunReceipt {
  mode: "dry_run";
  walletAddress: string;
  sourceTokenAccount: string;
  mint: string;
  amountRaw: string;
  amountFormatted: string;
  decimals: number;
  generatedAt: string;
  poccFallback: boolean;
  collaborationUsageRule: string;
  protocolExecutionEnabled: false;
  realWalletTransfer: false;
  realBurnTransaction: false;
  signingEnabled: false;
}

export function useAgentCollaboration() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [receipt, setReceipt] = useState<AgentCollaborationDryRunReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createCollaborationDryRun = useCallback(async (connection: WalletConnection) => {
    setIsProcessing(true);
    setError(null);
    setReceipt(null);

    try {
      if (TRANSFER_ENABLED || BURN_ENABLED || PROTOCOL_EXECUTION_ENABLED) {
        throw new Error("Protocol execution is disabled for Phase 4E readonly collaboration.");
      }
      if (connection.rail !== "solana") {
        throw new Error("PoCC collaboration dry-run currently requires a Solana identity.");
      }
      const decimals = await readLifePlusDecimals(connection);
      const fee = await calculateCollaborationFee(decimals);
      const mint = getLifePlusMint();
      const source = getAssociatedTokenAddress(connection.address, mint);
      const nextReceipt: AgentCollaborationDryRunReceipt = {
        mode: "dry_run",
        walletAddress: connection.address,
        sourceTokenAccount: source,
        mint: LIFE_PLUS_MINT,
        amountRaw: fee.amountRaw,
        amountFormatted: fee.amountFormatted,
        decimals,
        generatedAt: new Date().toISOString(),
        poccFallback: fee.fallback,
        collaborationUsageRule: AHIN_COLLABORATION_USAGE_RULE,
        protocolExecutionEnabled: false,
        realWalletTransfer: false,
        realBurnTransaction: false,
        signingEnabled: false
      };
      setReceipt(nextReceipt);
      setIsProcessing(false);
      return nextReceipt;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "PoCC collaboration dry-run failed.";
      setError(message);
      setIsProcessing(false);
      throw new Error(message);
    }
  }, []);

  const executeAgentTask = useCallback(
    async <T>(connection: WalletConnection, task: () => Promise<T> | T) => {
      const collaborationReceipt = await createCollaborationDryRun(connection);
      const result = await task();
      return { collaborationReceipt, result };
    },
    [createCollaborationDryRun]
  );

  return {
    executeAgentTask,
    createCollaborationDryRun,
    isProcessing,
    receipt,
    error
  };
}
