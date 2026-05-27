/**
 * Solana transaction construction utilities — Phase 2.
 *
 * Pure building blocks: no signing, no broadcasting, no wallet adapter use.
 * The caller decides who signs and whether to send. This keeps the
 * authorization gating (TRANSFER_ENABLED check) at the call site rather
 * than buried in a utility.
 *
 * All construction happens against the currently-configured RPC; we don't
 * own a Connection here — the caller passes one in. (For Gatekeeper-side
 * callers, the cached Connection from lifePlusSolana.ts can be reused.)
 *
 * Scope: a single function for the entry/usage fee transfer path.
 * The deflationary burn narrative has been retired — entry fees route
 * to the canonical Squads multisig treasury as Protocol-Owned Liquidity.
 */

import {
  Connection,
  PublicKey,
  Transaction
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { LIFE_PLUS_MINT } from "../config/life-plus";
import { readLifePlusDecimals } from "./lifePlusSolana";

export interface UsageFeeTxParams {
  /** Live RPC connection. Caller-owned (reuse the lifePlusSolana cache). */
  connection: Connection;
  /** End-user wallet pubkey — pays the fee + signs the tx. */
  walletPubkey: PublicKey;
  /** Treasury (or any destination) wallet pubkey — receives the fee. */
  treasuryPubkey: PublicKey;
  /**
   * Raw u64 fee amount, already decimal-shifted to the mint's smallest
   * unit (e.g. for LIFE++ at 9 decimals, 1 LIFE++ = 1_000_000_000n).
   * Must be > 0n.
   */
  feeAmountRaw: bigint;
  /** Defaults to LIFE_PLUS_MINT. Allows alt mints for testing. */
  mint?: PublicKey;
  /**
   * Defaults to readLifePlusDecimals() (env-or-9). createTransferChecked
   * validates the on-chain mint's decimals match this value, so a wrong
   * decimal here will be caught by the runtime rather than silently
   * transferring the wrong amount.
   */
  decimals?: number;
  /**
   * If true, treasury ATA derivation allows owner-off-curve. Required
   * when the treasury is a PDA-owned account (e.g. a Squads multisig
   * vault). Defaults to true since our canonical treasury at
   * 5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo is a Squads multisig.
   * Set false for plain wallet destinations.
   */
  treasuryAllowOwnerOffCurve?: boolean;
  /**
   * Pre-fetched recent blockhash. When supplied, skips the internal
   * connection.getLatestBlockhash() call — useful when the caller has
   * already fetched it (e.g. payment preflight returns it so confirmation
   * polling can reuse the same lastValidBlockHeight).
   */
  recentBlockhash?: string;
}

/**
 * Build (but do NOT sign or send) a Transaction that transfers
 * `feeAmountRaw` of LIFE++ from the user's ATA to the treasury's ATA.
 *
 * The returned Transaction is ready for the caller to:
 *   1. Hand to the connected wallet for signing (Phantom/OKX/etc.
 *      `signTransaction` API, or wallet-adapter `signTransaction`).
 *   2. Submit via `connection.sendRawTransaction(signed.serialize())`
 *      OR via the wallet's `signAndSendTransaction` shortcut.
 *
 * CRITICAL: this function does not gate on TRANSFER_ENABLED. The caller
 * MUST check it and refuse to broadcast when unarmed. See
 * src/config/life-plus.ts for the gate semantics.
 *
 * Choice of createTransferCheckedInstruction (vs createTransferInstruction):
 *   - Checked variant requires the mint pubkey and the expected decimals
 *     to be supplied in the instruction itself. The on-chain SPL Token
 *     program rejects the tx if either mismatches the ATA's actual mint.
 *   - This eliminates a class of bugs where the caller passes a
 *     wrong-mint ATA and silently transfers the wrong asset. Worth the
 *     one extra account in the instruction.
 *
 * Pre-flight responsibilities of the caller (NOT done here):
 *   - Confirm the user's source ATA actually exists. If not, this tx
 *     will fail at simulation time with TokenAccountNotFoundError.
 *   - Confirm the treasury destination ATA exists. If not, the caller
 *     should prepend a createAssociatedTokenAccountInstruction
 *     (a separate utility we can add when needed).
 *   - Confirm source balance >= feeAmountRaw. Otherwise sim fails with
 *     InsufficientFunds.
 *
 * Returns a legacy Transaction. If we later need ALTs / priority fees /
 * compute budget instructions, we can refactor to VersionedTransaction
 * here without changing the caller surface much.
 */
export async function buildUsageFeeTransaction(
  params: UsageFeeTxParams
): Promise<Transaction> {
  const {
    connection,
    walletPubkey,
    treasuryPubkey,
    feeAmountRaw,
    mint = new PublicKey(LIFE_PLUS_MINT),
    decimals,
    treasuryAllowOwnerOffCurve = true
  } = params;

  if (feeAmountRaw <= 0n) {
    throw new Error(
      `buildUsageFeeTransaction: feeAmountRaw must be > 0n (got ${feeAmountRaw}).`
    );
  }

  const tokenDecimals =
    typeof decimals === "number" ? decimals : await readLifePlusDecimals();

  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) {
    throw new Error(
      `buildUsageFeeTransaction: implausible decimals ${tokenDecimals}.`
    );
  }

  // ATAs are deterministic from (mint, owner). No RPC needed for derivation.
  // Source = user wallet ATA. End-user wallets are on the Ed25519 curve, so
  // allowOwnerOffCurve = false here is the safe constraint.
  const sourceAta = getAssociatedTokenAddressSync(mint, walletPubkey, false);

  // Destination = treasury ATA. The canonical treasury is a Squads multisig
  // vault, which is a PDA (off-curve), so we default to allowOwnerOffCurve
  // = true. The caller can override via params.treasuryAllowOwnerOffCurve
  // for plain destinations.
  const destAta = getAssociatedTokenAddressSync(
    mint,
    treasuryPubkey,
    treasuryAllowOwnerOffCurve
  );

  const ix = createTransferCheckedInstruction(
    sourceAta,
    mint,
    destAta,
    walletPubkey,
    feeAmountRaw,
    tokenDecimals
  );

  // Fetch a fresh blockhash so the tx is broadcastable for ~150 slots
  // (~60s). The caller should sign + send promptly after build; if they
  // dawdle, this will need a rebuild before send.
  //
  // When the caller pre-fetched a blockhash (e.g. paymentPreflight already
  // ran getLatestBlockhash), we reuse it so the lastValidBlockHeight the
  // caller retained matches what's actually in the tx.
  const blockhash =
    params.recentBlockhash ??
    (await connection.getLatestBlockhash("confirmed")).blockhash;

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: walletPubkey
  }).add(ix);

  return tx;
}
