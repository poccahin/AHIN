"use client";

/**
 * LifePaymentModule — Phase 2 usage-fee deposit UI.
 *
 * Renders the "Deposit to Liquidity Pool / Transfer to PoCC Treasury" CTA.
 *
 * Flow:
 *   1. On mount, fetch the Jupiter LIFE++/USDC quote and resolve the
 *      min(1 USDT, 1 LIFE++) fee via poccConsensus.calculateCollaborationFee.
 *      Fallback path emits a flat 1 LIFE++ if Jupiter is unavailable.
 *   2. On user click, build a transfer Transaction with
 *      buildUsageFeeTransaction targeting the canonical Squads multisig
 *      treasury at 5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo.
 *   3. EXECUTION GATE:
 *        - TRANSFER_ENABLED === true  → sign + broadcast via
 *          executeTransaction; capture the signature.
 *        - TRANSFER_ENABLED === false → console.warn and simulate success
 *          so the gatekeeper state machine can still proceed in readonly
 *          environments (devnet rehearsal, mock, unarmed deploys).
 *   4. Notify the caller via onSuccess(signature | null).
 *
 * No burn terminology — entry fees route to Protocol-Owned Liquidity.
 */

import { useCallback, useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { TRANSFER_ENABLED } from "../config/life-plus";
import { buildUsageFeeTransaction } from "../lib/transactionSolana";
import { executeTransaction } from "../lib/walletAdapters";
import type { WalletConnection } from "../lib/walletAdapters";
import { readLifePlusDecimals } from "../lib/lifePlusSolana";
import {
  calculateCollaborationFee,
  formatTokenAmount,
  type PoccCollaborationFee
} from "../services/poccConsensus";

/** Canonical Squads multisig treasury — destination for usage fees. */
const TREASURY_ADDRESS = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";

/**
 * Default RPC fallback if NEXT_PUBLIC_SOLANA_RPC_URL isn't set. Devnet —
 * production must set the env explicitly (matches the policy in
 * lifePlusSolana.ts and assetConfig.ts).
 */
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

type Phase =
  | "idle"
  | "quoting"
  | "ready"
  | "signing"
  | "broadcasting"
  | "success"
  | "error";

export interface LifePaymentModuleProps {
  connection: WalletConnection;
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---- Quote fetch ----
  const loadQuote = useCallback(async () => {
    setPhase("quoting");
    setErrorMessage(null);
    try {
      const decimals = await readLifePlusDecimals(connection);
      const resolved = await calculateCollaborationFee(decimals);
      setFee(resolved);
      setPhase("ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to load PoCC fee quote.";
      setErrorMessage(msg);
      setPhase("error");
      onError?.(err instanceof Error ? err : new Error(msg));
    }
  }, [connection, onError]);

  useEffect(() => {
    if (connection.rail !== "solana") {
      setErrorMessage("Liquidity Pool deposit requires a Solana wallet.");
      setPhase("error");
      return;
    }
    void loadQuote();
  }, [connection.rail, loadQuote]);

  // ---- Execution ----
  async function executeDeposit() {
    if (!fee) return;
    setPhase("signing");
    setErrorMessage(null);

    try {
      const rpcUrl =
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL;
      const conn = new Connection(rpcUrl, "confirmed");

      const tx = await buildUsageFeeTransaction({
        connection: conn,
        walletPubkey: new PublicKey(connection.address),
        treasuryPubkey: new PublicKey(TREASURY_ADDRESS),
        feeAmountRaw: BigInt(fee.amountRaw),
        decimals: fee.lifeDecimals
      });

      let sig: string | null = null;
      if (TRANSFER_ENABLED) {
        setPhase("broadcasting");
        sig = await executeTransaction(connection.id, tx, conn);
        setSignature(sig);
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          "Transfer disabled by configuration gates. Simulating success."
        );
      }

      setPhase("success");
      onSuccess?.(sig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deposit failed.";
      setErrorMessage(msg);
      setPhase("error");
      onError?.(err instanceof Error ? err : new Error(msg));
    }
  }

  // ---- Render ----
  const feeDisplay = fee
    ? `${formatTokenAmount(BigInt(fee.amountRaw), fee.lifeDecimals)} LIFE++`
    : null;

  const isBusy =
    phase === "quoting" ||
    phase === "signing" ||
    phase === "broadcasting";

  const buttonDisabled = isBusy || phase === "success" || !fee;

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
            {TREASURY_ADDRESS.slice(0, 6)}…{TREASURY_ADDRESS.slice(-4)}
          </dd>
        </div>
        <div className="flex items-center justify-between text-white/70">
          <dt>Fee</dt>
          <dd className="font-mono text-xs text-white/90">
            {phase === "quoting"
              ? "Fetching Jupiter quote…"
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

      {phase === "success" ? (
        <div className="mt-5 rounded-xl border border-emerald-200/20 bg-emerald-200/[0.05] p-3 text-sm text-emerald-100/90">
          <p className="font-medium">Deposit recorded.</p>
          {signature ? (
            <p className="mt-1 break-all font-mono text-[11px] text-emerald-100/75">
              tx: {signature}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-emerald-100/75">
              Simulated (TRANSFER_ENABLED is false in this environment).
            </p>
          )}
        </div>
      ) : null}

      {errorMessage ? (
        <p className="mt-3 text-[12px] leading-5 text-amber-200/85">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="button"
        disabled={buttonDisabled}
        onClick={executeDeposit}
        className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl border border-white/20 bg-white text-sm font-semibold text-[#050505] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-white/[0.12] disabled:text-white/[0.34]"
      >
        {phase === "signing"
          ? "Awaiting wallet signature…"
          : phase === "broadcasting"
            ? "Broadcasting to PoCC Treasury…"
            : phase === "success"
              ? "Deposit Recorded"
              : "Deposit to Liquidity Pool"}
      </button>

      <p className="mt-3 text-center text-[10px] text-white/35">
        {TRANSFER_ENABLED
          ? "Live transfer enabled in this environment."
          : "Readonly evidence mode — no on-chain transfer will be broadcast."}
      </p>
    </div>
  );
}
