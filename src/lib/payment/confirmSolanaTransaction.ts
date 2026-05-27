/**
 * Solana transaction confirmation polling — Phase P2P.
 *
 * After executeTransaction returns a signature, the tx is *submitted* but
 * not yet *finalized*. The Worker should not call grantAccess until we
 * see confirmation. This module implements the polling.
 *
 * Uses connection.confirmTransaction with a blockhash-based strategy,
 * wrapped in an AbortController so the caller can bound total wait time.
 *
 * Confirmation outcomes are reduced to a stable enum the UI can switch on:
 *   confirmed → tx landed cleanly; grant access
 *   expired   → block height exceeded; rebuild required
 *   timeout   → poll budget exhausted but tx may still land; show explorer
 *   rpc_error → tx landed but reverted, OR network error
 */

import type { Connection } from "@solana/web3.js";

export type ConfirmationResult = "confirmed" | "expired" | "timeout" | "rpc_error";

export interface ConfirmTxParams {
  connection: Connection;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /** Hard ceiling on total wait. Default 60s per spec. */
  timeoutMs?: number;
}

export interface ConfirmTxReport {
  result: ConfirmationResult;
  /** Set when the chain returned a tx-level error (result = "rpc_error"). */
  onChainError?: string;
  /** ms spent polling (approximate). */
  elapsedMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function confirmSolanaTransaction(
  params: ConfirmTxParams
): Promise<ConfirmTxReport> {
  const {
    connection,
    signature,
    blockhash,
    lastValidBlockHeight,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = params;

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
        abortSignal: controller.signal
      },
      "confirmed"
    );
    if (response.value.err) {
      return {
        result: "rpc_error",
        onChainError: JSON.stringify(response.value.err),
        elapsedMs: Date.now() - start
      };
    }
    return { result: "confirmed", elapsedMs: Date.now() - start };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const message = String((err as { message?: string })?.message ?? "").toLowerCase();
    const elapsedMs = Date.now() - start;

    if (name === "AbortError" || message.includes("aborted") || message.includes("timed out")) {
      return { result: "timeout", elapsedMs };
    }
    if (
      message.includes("expired") ||
      message.includes("block height exceeded") ||
      message.includes("blockhash not found")
    ) {
      return { result: "expired", elapsedMs };
    }
    return { result: "rpc_error", onChainError: message || undefined, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lightweight signature-status check for the in-flight recovery path
 * (page refresh during a pending tx). Doesn't require knowing the
 * blockhash, so it works even when the original Transaction context
 * is lost.
 *
 * Returns null when status can't be resolved (treat as unknown — show
 * an explorer link, don't grant access).
 */
export async function checkSignatureStatus(
  connection: Connection,
  signature: string
): Promise<"confirmed" | "finalized" | "processed" | "failed" | null> {
  try {
    const response = await connection.getSignatureStatuses([signature]);
    const status = response.value[0];
    if (!status) return null;
    if (status.err) return "failed";
    if (status.confirmationStatus === "finalized") return "finalized";
    if (status.confirmationStatus === "confirmed") return "confirmed";
    if (status.confirmationStatus === "processed") return "processed";
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a Solana explorer URL for a signature on the configured cluster.
 * Used when confirmation times out so the user can self-verify.
 */
export function explorerUrlForSignature(signature: string, cluster: string): string {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${encodeURIComponent(cluster)}`;
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
}
