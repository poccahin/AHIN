/**
 * LIFE++ Solana read primitives.
 *
 * Phase 1 of the Web3 reintegration: replaces the throwing readonly stubs
 * with real `@solana/web3.js` + `@solana/spl-token` chain reads.
 *
 * Scope:
 *   - getAssociatedTokenAddress (sync, deterministic ATA derivation)
 *   - readLifePlusBalanceRaw    (RPC call, returns 0n for non-existent ATAs)
 *   - readLifePlusDecimals      (env-configured, defaults to 9)
 *   - existing flag/mint exports preserved for callers
 *
 * Network selection: RPC URL is read from NEXT_PUBLIC_SOLANA_RPC_URL (set
 * via wrangler.workers.jsonc). Defaults to devnet for Phase 1 rehearsal
 * safety — never silently fall back to mainnet.
 *
 * Burns / signed transactions are explicitly OUT OF SCOPE for this file.
 * They'll live in a separate module (LifePaymentModule) when we get there.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync as splGetAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  BURN_ENABLED,
  LIFE_PLUS_MINT,
  PROTOCOL_EXECUTION_ENABLED,
  TRANSFER_ENABLED
} from "../config/life-plus";
import { isLikelySolanaAddress } from "./addressValidation";
import type { WalletConnection } from "./walletAdapters";

export const LIFE_PLUS_CA = LIFE_PLUS_MINT;
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

/**
 * Default RPC if NEXT_PUBLIC_SOLANA_RPC_URL is not set on this environment.
 * Devnet, intentionally — production must opt in explicitly via env so we
 * never accidentally hit mainnet from an unconfigured deploy.
 */
const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

function resolveRpcUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_RPC_URL;
}

/**
 * Memoize one Connection per (RPC URL) so repeated balance reads from the
 * Gatekeeper PoCC flow don't reopen HTTP keep-alive each call. Cache is
 * keyed by URL so a runtime env change invalidates it cleanly.
 */
let connectionCache: { url: string; conn: Connection } | null = null;
function getConnection(): Connection {
  const url = resolveRpcUrl();
  if (connectionCache && connectionCache.url === url) return connectionCache.conn;
  // 'confirmed' is the standard choice for UX-facing balance reads — fast
  // enough for interactive flows, durable enough for entry-gate decisions.
  // 'finalized' adds ~10s of latency; 'processed' is too racy.
  const conn = new Connection(url, "confirmed");
  connectionCache = { url, conn };
  return conn;
}

export function getLifePlusMint(): string {
  return LIFE_PLUS_CA;
}

/**
 * Compute the SPL Associated Token Account address for (owner, mint).
 *
 * Returns a base58-encoded PublicKey string. Throws if either input is not
 * a well-formed Solana address (cheap pre-check) — the spl-token primitive
 * would throw with a less actionable message.
 */
export function getAssociatedTokenAddress(
  ownerAddress: string,
  mint: string = getLifePlusMint()
): string {
  if (!isLikelySolanaAddress(ownerAddress) || !isLikelySolanaAddress(mint)) {
    throw new Error("Solana address validation failed.");
  }
  const ata = splGetAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(ownerAddress),
    // allowOwnerOffCurve = false. For end-user wallets the owner is an
    // Ed25519 keypair on the curve. Flip to true only if we ever serve a
    // PDA-owned holdings flow.
    false
  );
  return ata.toBase58();
}

// Preserve the historical alias used by some callers.
export const getAssociatedTokenAddressSync = getAssociatedTokenAddress;

export function isLiveLifePlusTransferEnabled(): boolean {
  return TRANSFER_ENABLED && !BURN_ENABLED && PROTOCOL_EXECUTION_ENABLED;
}

/**
 * LIFE++ decimal places.
 *
 * Configurable via NEXT_PUBLIC_LIFE_PLUS_DECIMALS for environments where
 * the value diverges. Defaults to 9 (Solana SPL-Token default; matches the
 * live LIFE++ mint).
 *
 * Phase 1 does not query the mint account on-chain — that's a follow-up if
 * we ever want to remove the env-config branch. Reading mint info adds an
 * RPC call to every balance check, which is excessive for a value that
 * changes ~never.
 */
export async function readLifePlusDecimals(
  _connection?: WalletConnection
): Promise<number> {
  const configured = process.env.NEXT_PUBLIC_LIFE_PLUS_DECIMALS;
  if (configured && /^\d+$/.test(configured)) {
    return Number.parseInt(configured, 10);
  }
  return 9;
}

/**
 * Read the on-chain LIFE++ balance (raw u64, NOT decimal-shifted) for the
 * given wallet.
 *
 * Behavior contract:
 *   - Returns 0n when the wallet's ATA does not exist (brand-new wallet
 *     that has never received LIFE++). Detected by best-effort error
 *     message inspection — see isAccountNotFoundError below.
 *   - Rethrows on any other RPC failure (network, rate limit, malformed
 *     response). Callers in the Gatekeeper PoCC layer convert these into
 *     a "blocked / readonly quote unavailable" state.
 *
 * The `connection: WalletConnection` parameter is the dapp-side wallet
 * adapter handle (used only for its `.address`), NOT the Solana RPC
 * connection — the RPC client is constructed internally from env config.
 */
export async function readLifePlusBalanceRaw(
  connection: WalletConnection,
  ownerAddress: string = connection.address
): Promise<bigint> {
  if (!isLikelySolanaAddress(ownerAddress)) {
    throw new Error("Solana address validation failed.");
  }

  const conn = getConnection();
  const ataStr = getAssociatedTokenAddress(ownerAddress);
  const ata = new PublicKey(ataStr);

  try {
    const res = await conn.getTokenAccountBalance(ata);
    // res.value.amount is the raw u64 as a decimal string. Parse to bigint
    // (decimal-shifted application happens in the PoCC consensus layer).
    return BigInt(res.value.amount);
  } catch (err) {
    if (isAccountNotFoundError(err)) {
      return 0n;
    }
    throw err;
  }
}

/**
 * Best-effort detection of the "this ATA doesn't exist yet" error family.
 *
 * Solana RPCs return varying error shapes for missing accounts:
 *   - JSON-RPC error with code -32602 and message
 *       "Invalid param: could not find account"
 *   - Plain error with message "could not find account"
 *   - "Account does not exist <pubkey>"
 *   - Some adapters wrap in SendTransactionError / RpcResponseError
 *
 * web3.js doesn't expose a single typed AccountNotFoundError we can
 * instanceof-check across versions, so we inspect `.message` broadly.
 * Anything unrecognized is treated as a real failure and rethrown.
 */
function isAccountNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : "";
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("could not find account") ||
    lower.includes("account does not exist") ||
    lower.includes("invalid param: could not find") ||
    lower.includes("account not found")
  );
}
