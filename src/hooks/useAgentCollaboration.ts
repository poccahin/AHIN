"use client";

import { useCallback, useState } from "react";
import {
  AHIN_COLLABORATION_USAGE_RULE,
  LIFE_PLUS_MINT,
  PROTOCOL_EXECUTION_ENABLED,
  TRANSFER_ENABLED
} from "../config/life-plus";
import { calculateCollaborationFee } from "../services/poccConsensus";
import {
  getAssociatedTokenAddress,
  getLifePlusMint,
  readLifePlusDecimals
} from "../lib/lifePlusSolana";
import { useAuthStore } from "../store/authStore";
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
  /**
   * Retained as `realBurnTransaction: false` to preserve compatibility
   * with the release linter (scripts/release-lint.mjs asserts this
   * audit field by name). The deflationary burn narrative was retired
   * in 8532ceb — the field name is historical.
   */
  realBurnTransaction: false;
  signingEnabled: false;
  /**
   * Real on-chain entry transaction signature, threaded in from the
   * global authStore session when the user entered via the live PoCC
   * Treasury transfer path (LifePaymentModule). null in mock mode or
   * before the user has completed entry.
   */
  entryTransactionSignature: string | null;
  /**
   * Structured usage-fee transfer attestation. Mirrors the shape the
   * downstream agent payload schema expects: an explicit signature ref
   * + mode indicator so the agent side can route on either.
   */
  realUsageFeeTransfer: {
    signature: string | null;
    mode: "mock" | "live";
  };
}

function isMockSignature(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return true;
  return value.startsWith("mock-") || value.startsWith("dry-run-");
}

export function useAgentCollaboration() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [receipt, setReceipt] =
    useState<AgentCollaborationDryRunReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createCollaborationDryRun = useCallback(
    async (connection: WalletConnection) => {
      setIsProcessing(true);
      setError(null);
      setReceipt(null);

      try {
        const { gateMode, session } = useAuthStore.getState();
        const isLive = gateMode === "live";

        // Defensive guard: in mock mode, real-mode flags should never
        // resolve true. If they do, something else is misconfigured and
        // we refuse to emit a receipt that would silently look mock-shaped
        // while flags claim otherwise.
        if (!isLive && (TRANSFER_ENABLED || PROTOCOL_EXECUTION_ENABLED)) {
          throw new Error(
            "Protocol execution is disabled for Phase 4E readonly collaboration."
          );
        }
        if (connection.rail !== "solana") {
          throw new Error(
            "PoCC collaboration dry-run currently requires a Solana identity."
          );
        }

        const decimals = await readLifePlusDecimals(connection);
        const fee = await calculateCollaborationFee(decimals);
        const mint = getLifePlusMint();
        const source = getAssociatedTokenAddress(connection.address, mint);

        // Pull real entry signature from session, but only treat it as
        // "real" if it doesn't bear a mock/dry-run prefix. This keeps
        // mock sessions from polluting agent payloads with fake hashes
        // labeled as on-chain proofs.
        const sessionSig = session?.entryFee.signature ?? null;
        const entryTransactionSignature = isMockSignature(sessionSig)
          ? null
          : sessionSig;

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
          signingEnabled: false,
          entryTransactionSignature,
          realUsageFeeTransfer: {
            signature: entryTransactionSignature,
            mode: entryTransactionSignature ? "live" : "mock"
          }
        };
        setReceipt(nextReceipt);
        setIsProcessing(false);
        return nextReceipt;
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "PoCC collaboration dry-run failed.";
        setError(message);
        setIsProcessing(false);
        throw new Error(message);
      }
    },
    []
  );

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
