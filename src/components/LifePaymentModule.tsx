"use client";

/**
 * LifePaymentModule — Phase P2P canary-aware payment UI.
 *
 * Two paths, selected at runtime by INFRASTRUCTURE_TRANSFER_ARMED:
 *
 *   1. Dry-run (TRANSFER_ENABLED=false at infra level):
 *        Skip preflight. Build a tx for shape verification. Skip sign.
 *        Synthesize a "confirmed" outcome with signature=null and call
 *        onSuccess(null). Used in mock/devnet/unarmed envs.
 *
 *   2. Canary (TRANSFER_ENABLED=true at infra level):
 *        Run mainnet preflight. If preflight blocks, surface the blocker
 *        with the right copy. If preflight passes, evaluate canary
 *        authorization (allowlist + cap). If unauthorized, block with
 *        readiness copy. Otherwise: build → awaiting_signature (with
 *        90s countdown + cancel) → sign → submitted → confirming →
 *        confirmed → grantAccess.
 *
 * grantAccess is invoked via onSuccess EXACTLY ONCE per attempt, and
 * ONLY after the confirmation outcome. A returned signature alone never
 * grants access — confirmation must succeed first.
 *
 * No burn terminology — entry fees route to Protocol-Owned Liquidity.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  INFRASTRUCTURE_TRANSFER_ARMED,
  AHIN_TREASURY_MULTISIG_ADDRESS,
  LIFE_PLUS_MINT,
  isCanaryPaymentAuthorized,
  CANARY_BLOCK_COPY
} from "../config/life-plus-payment";
import { buildUsageFeeTransaction } from "../lib/transactionSolana";
import { executeTransaction } from "../lib/walletAdapters";
import type { WalletConnection } from "../lib/walletAdapters";
import { readLifePlusDecimals } from "../lib/lifePlusSolana";
import {
  calculateCollaborationFee,
  formatTokenAmount,
  type PoccCollaborationFee
} from "../services/poccConsensus";
import {
  classifyWalletPaymentError,
  PAYMENT_ERROR_COPY,
  isRecoverable,
  type PaymentErrorClass
} from "../lib/payment/paymentErrors";
import { runPaymentPreflight } from "../lib/payment/paymentPreflight";
import {
  confirmSolanaTransaction,
  checkSignatureStatus,
  explorerUrlForSignature
} from "../lib/payment/confirmSolanaTransaction";
import {
  newPaymentRequestId,
  logPaymentTelemetry
} from "../lib/payment/paymentTelemetry";
import {
  savePaymentIntent,
  loadPaymentIntent,
  clearPaymentIntent,
  isIntentStale,
  type PaymentIntentRecord
} from "../lib/payment/paymentIntent";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const SIGNATURE_TIMEOUT_MS = 90_000;
const STALE_BLOCKHASH_WARN_MS = 45_000;
const CONFIRMATION_TIMEOUT_MS = 60_000;

type Phase =
  | "idle"
  | "ready"
  | "preflight"
  | "building"
  | "awaiting_signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "recoverable_error"
  | "fatal_error";

interface PhaseError {
  class: PaymentErrorClass | "canary_block";
  message: string;
  recoverable: boolean;
  /** Optional Solana explorer link for timeout / verification states. */
  explorerUrl?: string;
}

export interface LifePaymentModuleProps {
  connection: WalletConnection;
  /** Called once on confirmed-success (signature) OR confirmed dry-run (null). */
  onSuccess?: (signature: string | null) => void;
  onError?: (error: Error) => void;
}

export default function LifePaymentModule({
  connection,
  onSuccess,
  onError
}: LifePaymentModuleProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fee, setFee] = useState<PoccCollaborationFee | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [phaseError, setPhaseError] = useState<PhaseError | null>(null);
  const [awaitingDeadline, setAwaitingDeadline] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [resumeIntent, setResumeIntent] = useState<PaymentIntentRecord | null>(null);

  // Sticky per-attempt IDs (not regenerated on rerender)
  const requestIdRef = useRef<string>(newPaymentRequestId("pay"));
  const buildTimestampRef = useRef<number | null>(null);
  /**
   * Idempotency guard for onSuccess: ensures we never call grantAccess
   * more than once per mount/attempt sequence even if multiple effects
   * race during recovery.
   */
  const successCalledRef = useRef(false);

  const expectedCluster =
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || "devnet";

  // ---- Quote fetch ----
  const loadQuote = useCallback(async () => {
    setPhase("idle");
    setPhaseError(null);
    try {
      const decimals = await readLifePlusDecimals(connection);
      const resolved = await calculateCollaborationFee(decimals);
      setFee(resolved);
      setPhase("ready");
    } catch (err) {
      const cls = classifyWalletPaymentError(err);
      setPhaseError({
        class: cls,
        message: PAYMENT_ERROR_COPY[cls],
        recoverable: isRecoverable(cls)
      });
      setPhase(isRecoverable(cls) ? "recoverable_error" : "fatal_error");
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [connection, onError]);

  // ---- Mount: validate rail, load quote, check for in-flight intent ----
  useEffect(() => {
    if (connection.rail !== "solana") {
      setPhaseError({
        class: "wrong_network",
        message: "Liquidity Pool deposit requires a Solana wallet.",
        recoverable: false
      });
      setPhase("fatal_error");
      return;
    }
    // Check for in-flight intent BEFORE kicking off a new quote.
    const stored = loadPaymentIntent();
    if (stored) {
      if (isIntentStale(stored) || stored.wallet !== connection.address) {
        clearPaymentIntent();
      } else {
        setResumeIntent(stored);
      }
    }
    void loadQuote();
  }, [connection.address, connection.rail, loadQuote]);

  // ---- Awaiting-signature countdown ----
  useEffect(() => {
    if (phase !== "awaiting_signature" || awaitingDeadline === null) return;
    const tick = () => {
      const remainingMs = awaitingDeadline - Date.now();
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setCountdown(remainingSeconds);
      if (remainingMs <= 0) {
        // Soft timeout — wallet might still be open; surface a recoverable
        // error with explicit copy that does NOT claim failure.
        setPhaseError({
          class: "rpc_timeout",
          message:
            "Wallet did not respond within 90s. If the wallet popup is still open, complete the signature there. Otherwise click Try again.",
          recoverable: true
        });
        setPhase("recoverable_error");
        setAwaitingDeadline(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, awaitingDeadline]);

  // ---- Cancel during awaiting_signature ----
  function handleCancel() {
    // Reset to ready WITHOUT claiming the tx failed. The wallet popup,
    // if still open, is the user's to dismiss.
    setPhase("ready");
    setPhaseError(null);
    setAwaitingDeadline(null);
    setCountdown(0);
    setSignature(null);
    buildTimestampRef.current = null;
  }

  // ---- Helper: build an explorer URL for the current cluster ----
  function explorerFor(sig: string): string {
    return explorerUrlForSignature(sig, expectedCluster);
  }

  // ---- Dry-run path (TRANSFER_ENABLED=false at infra level) ----
  async function runDryRun(intentId: string, feeAmountRaw: bigint, lifeDecimals: number) {
    const rpcUrl =
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL;
    const conn = new Connection(rpcUrl, "confirmed");

    logPaymentTelemetry({
      requestId: requestIdRef.current,
      intentId,
      phase: "dry_run_building",
      timestamp: new Date().toISOString(),
      details: { feeAmountRaw: feeAmountRaw.toString() }
    });

    // Build the tx purely to verify shape — never broadcast.
    setPhase("building");
    await buildUsageFeeTransaction({
      connection: conn,
      walletPubkey: new PublicKey(connection.address),
      treasuryPubkey: new PublicKey(AHIN_TREASURY_MULTISIG_ADDRESS),
      feeAmountRaw,
      decimals: lifeDecimals
    });

    // eslint-disable-next-line no-console
    console.warn(
      "[ahin.payment] Transfer disabled by configuration gates. Dry-run only — no transaction submitted."
    );

    logPaymentTelemetry({
      requestId: requestIdRef.current,
      intentId,
      phase: "dry_run_confirmed",
      timestamp: new Date().toISOString()
    });

    setPhase("confirmed");
    if (!successCalledRef.current) {
      successCalledRef.current = true;
      onSuccess?.(null);
    }
  }

  // ---- Main execute flow ----
  async function executeDeposit() {
    if (!fee) return;
    if (phase === "preflight" || phase === "building" || phase === "awaiting_signature" || phase === "submitted" || phase === "confirming") {
      return; // ignore double-clicks
    }

    // Fresh attempt context — but keep the requestId for cross-attempt correlation.
    successCalledRef.current = false;
    setSignature(null);
    setPhaseError(null);
    buildTimestampRef.current = null;
    const intentId = newPaymentRequestId("intent");
    const feeAmountRaw = BigInt(fee.amountRaw);

    // Validate wallet pubkey
    let walletPubkey: PublicKey;
    try {
      walletPubkey = new PublicKey(connection.address);
    } catch {
      setPhaseError({
        class: "unknown",
        message: "Wallet address is not a valid Solana pubkey.",
        recoverable: false
      });
      setPhase("fatal_error");
      return;
    }

    // ---- Branch: dry-run vs canary path ----
    if (!INFRASTRUCTURE_TRANSFER_ARMED) {
      try {
        await runDryRun(intentId, feeAmountRaw, fee.lifeDecimals);
      } catch (err) {
        const cls = classifyWalletPaymentError(err);
        setPhaseError({
          class: cls,
          message: PAYMENT_ERROR_COPY[cls],
          recoverable: isRecoverable(cls)
        });
        setPhase(isRecoverable(cls) ? "recoverable_error" : "fatal_error");
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }

    // ---- Canary path: real broadcast (gated) ----
    const rpcUrl =
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL;
    const conn = new Connection(rpcUrl, "confirmed");
    const treasuryPubkey = new PublicKey(AHIN_TREASURY_MULTISIG_ADDRESS);
    const mintPubkey = new PublicKey(LIFE_PLUS_MINT);

    // Preflight
    setPhase("preflight");
    logPaymentTelemetry({
      requestId: requestIdRef.current,
      intentId,
      phase: "preflight",
      timestamp: new Date().toISOString(),
      details: { feeAmountRaw: feeAmountRaw.toString(), expectedCluster }
    });

    let preflight;
    try {
      preflight = await runPaymentPreflight({
        connection: conn,
        wallet: connection,
        walletPubkey,
        treasuryPubkey,
        mint: mintPubkey,
        feeAmountRaw,
        expectedCluster
      });
    } catch (err) {
      const cls = classifyWalletPaymentError(err);
      setPhaseError({
        class: cls,
        message: PAYMENT_ERROR_COPY[cls],
        recoverable: isRecoverable(cls)
      });
      setPhase(isRecoverable(cls) ? "recoverable_error" : "fatal_error");
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (!preflight.ok || !preflight.checks.latestBlockhash) {
      const blocker = preflight.blocker ?? "unknown";
      setPhaseError({
        class: blocker,
        message: PAYMENT_ERROR_COPY[blocker],
        recoverable: isRecoverable(blocker)
      });
      setPhase(isRecoverable(blocker) ? "recoverable_error" : "fatal_error");
      return;
    }

    const { blockhash, lastValidBlockHeight } = preflight.checks.latestBlockhash;

    // Canary authorization — order matters: preflight first (cheap to fix
    // mistakes), canary second (env-config issue).
    const canaryAuth = isCanaryPaymentAuthorized({
      wallet: connection.address,
      amountRaw: feeAmountRaw
    });
    if (!canaryAuth.authorized) {
      const reason = canaryAuth.reason ?? "canary_disabled";
      setPhaseError({
        class: "canary_block",
        message: CANARY_BLOCK_COPY[reason],
        recoverable: true
      });
      setPhase("recoverable_error");
      return;
    }

    // Build tx using preflight's blockhash (so lastValidBlockHeight matches)
    setPhase("building");
    logPaymentTelemetry({
      requestId: requestIdRef.current,
      intentId,
      buildTxId: newPaymentRequestId("build"),
      phase: "building",
      timestamp: new Date().toISOString()
    });

    let tx;
    try {
      tx = await buildUsageFeeTransaction({
        connection: conn,
        walletPubkey,
        treasuryPubkey,
        feeAmountRaw,
        decimals: fee.lifeDecimals,
        recentBlockhash: blockhash
      });
    } catch (err) {
      const cls = classifyWalletPaymentError(err);
      setPhaseError({
        class: cls,
        message: PAYMENT_ERROR_COPY[cls],
        recoverable: isRecoverable(cls)
      });
      setPhase(isRecoverable(cls) ? "recoverable_error" : "fatal_error");
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    buildTimestampRef.current = Date.now();

    // Save intent before signing — refresh recovery anchor
    const intent: PaymentIntentRecord = {
      intentId,
      wallet: connection.address,
      expectedAmountRaw: feeAmountRaw.toString(),
      treasuryAta: preflight.checks.treasuryAtaAddress,
      builtAt: new Date(buildTimestampRef.current).toISOString(),
      status: "awaiting_signature"
    };
    savePaymentIntent(intent);

    // ---- Awaiting signature ----
    setPhase("awaiting_signature");
    setAwaitingDeadline(Date.now() + SIGNATURE_TIMEOUT_MS);
    setCountdown(Math.ceil(SIGNATURE_TIMEOUT_MS / 1000));

    let sig: string;
    try {
      sig = await executeTransaction(connection.id, tx, conn);
    } catch (err) {
      setAwaitingDeadline(null);
      const cls = classifyWalletPaymentError(err);
      setPhaseError({
        class: cls,
        message: PAYMENT_ERROR_COPY[cls],
        recoverable: isRecoverable(cls)
      });
      setPhase(isRecoverable(cls) ? "recoverable_error" : "fatal_error");
      // Clear intent on terminal error — no signature to resume.
      clearPaymentIntent();
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    setAwaitingDeadline(null);
    setSignature(sig);

    // ---- Submitted ----
    setPhase("submitted");
    savePaymentIntent({ ...intent, status: "submitted", signature: sig });
    logPaymentTelemetry({
      requestId: requestIdRef.current,
      intentId,
      submitId: newPaymentRequestId("submit"),
      phase: "submitted",
      timestamp: new Date().toISOString(),
      details: { signature: sig }
    });

    // ---- Confirming ----
    setPhase("confirming");
    savePaymentIntent({ ...intent, status: "confirming", signature: sig });

    const confirmation = await confirmSolanaTransaction({
      connection: conn,
      signature: sig,
      blockhash,
      lastValidBlockHeight,
      timeoutMs: CONFIRMATION_TIMEOUT_MS
    });

    logPaymentTelemetry({
      requestId: requestIdRef.current,
      intentId,
      confirmationId: newPaymentRequestId("conf"),
      phase: "confirming_done",
      timestamp: new Date().toISOString(),
      details: { result: confirmation.result, elapsedMs: confirmation.elapsedMs }
    });

    if (confirmation.result === "confirmed") {
      savePaymentIntent({ ...intent, status: "confirmed", signature: sig });
      clearPaymentIntent();
      setPhase("confirmed");
      if (!successCalledRef.current) {
        successCalledRef.current = true;
        onSuccess?.(sig);
      }
      return;
    }

    // Non-confirmed outcomes — never grant access. Surface explorer link.
    if (confirmation.result === "timeout") {
      setPhaseError({
        class: "rpc_timeout",
        message:
          "Confirmation polling timed out. The transaction may still land. Check the explorer.",
        recoverable: true,
        explorerUrl: explorerFor(sig)
      });
    } else if (confirmation.result === "expired") {
      setPhaseError({
        class: "stale_blockhash",
        message: PAYMENT_ERROR_COPY.stale_blockhash,
        recoverable: true,
        explorerUrl: explorerFor(sig)
      });
    } else {
      setPhaseError({
        class: "unknown",
        message: "Transaction confirmation failed. Check the explorer.",
        recoverable: true,
        explorerUrl: explorerFor(sig)
      });
    }
    setPhase("recoverable_error");
    // Do NOT clear intent — user may want to resume / verify.
  }

  // ---- Resume in-flight intent (refresh recovery) ----
  async function resumeInFlightIntent() {
    if (!resumeIntent) return;

    if (!resumeIntent.signature) {
      // No signature recorded — nothing to verify on chain. Just clear.
      clearPaymentIntent();
      setResumeIntent(null);
      return;
    }

    setPhase("confirming");
    setSignature(resumeIntent.signature);

    const rpcUrl =
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL;
    const conn = new Connection(rpcUrl, "confirmed");
    const status = await checkSignatureStatus(conn, resumeIntent.signature);

    if (status === "confirmed" || status === "finalized") {
      clearPaymentIntent();
      setResumeIntent(null);
      setPhase("confirmed");
      if (!successCalledRef.current) {
        successCalledRef.current = true;
        onSuccess?.(resumeIntent.signature);
      }
      return;
    }

    // Anything else — show recoverable error with explorer link. Do NOT
    // auto-grant access. The user must wait and retry, or check the
    // explorer directly.
    setPhaseError({
      class: "rpc_timeout",
      message:
        status === "failed"
          ? "The recorded transaction reverted on chain. Check explorer."
          : "Could not confirm the recorded transaction. Check explorer.",
      recoverable: true,
      explorerUrl: explorerFor(resumeIntent.signature)
    });
    setPhase("recoverable_error");
  }

  function discardInFlightIntent() {
    clearPaymentIntent();
    setResumeIntent(null);
    setPhaseError(null);
    setPhase("ready");
  }

  // ---- Render helpers ----
  const feeDisplay = fee
    ? `${formatTokenAmount(BigInt(fee.amountRaw), fee.lifeDecimals)} LIFE++`
    : null;
  const isBusy =
    phase === "preflight" ||
    phase === "building" ||
    phase === "awaiting_signature" ||
    phase === "submitted" ||
    phase === "confirming";
  const isTerminalSuccess = phase === "confirmed";
  const buttonDisabled = isBusy || isTerminalSuccess || !fee;
  const showCancel = phase === "awaiting_signature";
  const showRetry = phase === "recoverable_error";

  const isStaleRisk =
    phase === "awaiting_signature" &&
    buildTimestampRef.current !== null &&
    Date.now() - buildTimestampRef.current > STALE_BLOCKHASH_WARN_MS;

  const primaryButtonLabel = (() => {
    switch (phase) {
      case "preflight":
        return "Running mainnet preflight…";
      case "building":
        return "Building transaction…";
      case "awaiting_signature":
        return `Awaiting wallet signature… ${countdown}s`;
      case "submitted":
        return "Submitted — awaiting confirmation…";
      case "confirming":
        return "Confirming…";
      case "confirmed":
        return "Deposit confirmed";
      case "recoverable_error":
        return "Try again";
      case "fatal_error":
        return "Unavailable";
      default:
        return "Deposit to Liquidity Pool";
    }
  })();

  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-6 text-white">
      <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">
        Liquidity Pool Deposit
      </p>
      <h3 className="mt-2 text-lg font-medium text-white/90">
        Transfer to PoCC Treasury
      </h3>

      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex items-center justify-between text-white/70">
          <dt>Destination</dt>
          <dd className="font-mono text-xs text-sky-100/85">
            {AHIN_TREASURY_MULTISIG_ADDRESS.slice(0, 6)}…
            {AHIN_TREASURY_MULTISIG_ADDRESS.slice(-4)}
          </dd>
        </div>
        <div className="flex items-center justify-between text-white/70">
          <dt>Fee</dt>
          <dd className="font-mono text-xs text-white/90">
            {phase === "idle" || phase === "ready"
              ? feeDisplay ?? "Fetching Jupiter quote…"
              : feeDisplay ?? "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between text-white/70">
          <dt>Rule</dt>
          <dd className="text-xs text-white/60">min(1 USDT, 1 LIFE++)</dd>
        </div>
        {fee?.fallback ? (
          <p className="text-[11px] text-amber-200/80">
            Jupiter unavailable; using fallback PoCC fee.
          </p>
        ) : null}
      </dl>

      {/* Resume in-flight prompt */}
      {resumeIntent && phase !== "confirming" && phase !== "confirmed" ? (
        <div className="mt-4 rounded-xl border border-sky-200/20 bg-sky-200/[0.05] p-3 text-sm text-sky-100/90">
          <p className="font-medium">In-flight payment detected.</p>
          <p className="mt-1 text-[12px] leading-5 text-sky-100/75">
            A prior payment attempt {resumeIntent.signature ? "submitted a signature " : ""}
            but didn't complete. Check status before starting a new attempt.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={resumeInFlightIntent}
              className="rounded-lg border border-sky-200/30 bg-sky-200/[0.08] px-3 py-1 text-xs text-sky-100/95 transition hover:bg-sky-200/[0.16]"
            >
              Resume payment check
            </button>
            <button
              type="button"
              onClick={discardInFlightIntent}
              className="rounded-lg border border-white/20 px-3 py-1 text-xs text-white/70 transition hover:bg-white/[0.06]"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {/* Awaiting-signature info copy */}
      {phase === "awaiting_signature" ? (
        <p className="mt-4 text-[12px] leading-5 text-white/60">
          Waiting for wallet signature. No transaction is submitted until you approve in wallet.
          {isStaleRisk ? (
            <span className="ml-1 text-amber-200/85">
              (Blockhash freshness approaching limit — rebuild may be needed on retry.)
            </span>
          ) : null}
        </p>
      ) : null}

      {/* Submitted/confirming status */}
      {(phase === "submitted" || phase === "confirming") && signature ? (
        <p className="mt-4 break-all text-[11px] font-mono leading-5 text-white/60">
          signature: {signature}
        </p>
      ) : null}

      {/* Confirmed success */}
      {phase === "confirmed" ? (
        <div className="mt-5 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.05] p-3 text-sm text-emerald-100/90">
          <p className="font-medium">Deposit confirmed.</p>
          {signature ? (
            <>
              <p className="mt-1 break-all font-mono text-[11px] text-emerald-100/75">
                tx: {signature}
              </p>
              <a
                href={explorerFor(signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[11px] text-emerald-100/85 underline hover:text-emerald-100"
              >
                View on Solana explorer
              </a>
            </>
          ) : (
            <p className="mt-1 text-[11px] text-emerald-100/75">
              Dry-run only — transfer infrastructure is not armed in this environment.
            </p>
          )}
        </div>
      ) : null}

      {/* Error states */}
      {phaseError ? (
        <div className="mt-4 rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-3 text-[12px] leading-5 text-amber-200/90">
          <p>{phaseError.message}</p>
          {phaseError.explorerUrl ? (
            <a
              href={phaseError.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-amber-100/95 underline hover:text-amber-100"
            >
              Check status on Solana explorer
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={buttonDisabled && !showRetry}
          onClick={executeDeposit}
          className="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-white/20 bg-white text-sm font-semibold text-[#050505] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-white/[0.12] disabled:text-white/[0.34]"
        >
          {primaryButtonLabel}
        </button>
        {showCancel ? (
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-xl border border-white/20 px-4 text-sm text-white/80 transition hover:bg-white/[0.06]"
          >
            Cancel
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-center text-[10px] text-white/35">
        {INFRASTRUCTURE_TRANSFER_ARMED
          ? "Live transfer enabled — gated by canary allowlist + cap."
          : "Readonly evidence mode — no on-chain transfer will be broadcast."}
      </p>
    </div>
  );
}
