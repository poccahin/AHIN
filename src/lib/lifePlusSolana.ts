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
 * Network selection (resolveRpcUrl, in priority order):
 *   1. SOLANA_RPC_URL            — server-only Worker secret. It is NOT a
 *                                  NEXT_PUBLIC_* var, so Next never inlines it
 *                                  into the client bundle. Set via `wrangler
 *                                  secret put SOLANA_RPC_URL`. This is where a
 *                                  paid RPC (Helius/Triton/…) whose URL carries
 *                                  an api-key belongs — it stays server-side.
 *   2. NEXT_PUBLIC_SOLANA_RPC_URL — public, client-visible endpoint (wrangler
 *                                  `vars`). Rate-limited on mainnet; never put
 *                                  a paid/keyed URL here (it ships to the
 *                                  browser).
 *   3. devnet default            — never silently fall back to mainnet.
 *
 * IMPORTANT — browser reads go through the server, not the RPC directly.
 * readLifePlusBalanceRaw is environment-aware: in the browser it fetches the
 * server route /api/solana/lifepp-balance (which resolves the SOLANA_RPC_URL
 * secret via getCloudflareContext().env and reads the chain server-side), so
 * the paid RPC endpoint is never exposed to client JS. On the server it reads
 * the chain directly via readLifePlusBalanceForOwner.
 *
 * Burns / signed transactions are explicitly OUT OF SCOPE for this file.
 * They'll live in a separate module (LifePaymentModule) when we get there.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync as splGetAssociatedTokenAddressSync } from "@solana/spl-token";
import {
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
  // 1. Server-only secret. SOLANA_RPC_URL is NOT NEXT_PUBLIC_*, so it is never
  //    inlined into the client bundle; in the browser process.env.
  //    SOLANA_RPC_URL is always undefined and this branch is skipped.
  //
  //    NOTE: on the Cloudflare Worker runtime, secrets set via `wrangler secret
  //    put` live on the request `env` binding, not process.env (which only
  //    mirrors wrangler `vars`). The production read path injects the secret
  //    explicitly via readLifePlusBalanceForOwner(owner, rpcUrlOverride) after
  //    resolving it with getCloudflareContext().env — see
  //    app/api/solana/lifepp-balance/route.ts. This process.env branch still
  //    covers local dev / `next dev` and any var-based SOLANA_RPC_URL.
  const serverSecret = process.env.SOLANA_RPC_URL?.trim();
  if (serverSecret && serverSecret.length > 0) return serverSecret;
  // 2. Public, client-visible endpoint.
  const publicEnv = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  // 3. Devnet default — never silently fall back to mainnet.
  return publicEnv && publicEnv.length > 0 ? publicEnv : DEFAULT_RPC_URL;
}

/**
 * Memoize one Connection per (RPC URL) so repeated balance reads from the
 * Gatekeeper PoCC flow don't reopen HTTP keep-alive each call. Cache is
 * keyed by URL so a runtime env change invalidates it cleanly.
 */
let connectionCache: { url: string; conn: Connection } | null = null;
function getConnection(rpcUrlOverride?: string): Connection {
  // An explicit override lets a server route inject an RPC URL it resolved
  // from a server-only source (the SOLANA_RPC_URL secret via the Cloudflare
  // env binding). When omitted we fall back to env resolution.
  const overridden = rpcUrlOverride?.trim();
  const url = overridden && overridden.length > 0 ? overridden : resolveRpcUrl();
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
  mint: string = getLifePlusMint(),
  allowOwnerOffCurve = false
): string {
  if (!isLikelySolanaAddress(ownerAddress) || !isLikelySolanaAddress(mint)) {
    throw new Error("Solana address validation failed.");
  }
  const ata = splGetAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(ownerAddress),
    // allowOwnerOffCurve: default false (end-user wallets are on-curve Ed25519
    // keypairs). The READONLY balance path passes true so PDA owners — e.g. the
    // Squads treasury multisig (5Cohfz…) — are queryable; for an on-curve owner
    // the derived ATA is identical, so this only *additionally* permits PDAs.
    // This affects ATA derivation for READS only; no transfer/signing path here
    // uses off-curve derivation.
    allowOwnerOffCurve
  );
  return ata.toBase58();
}

// Preserve the historical alias used by some callers.
export const getAssociatedTokenAddressSync = getAssociatedTokenAddress;

export function isLiveLifePlusTransferEnabled(): boolean {
  // TRANSFER_ENABLED already AND-includes the conditions of
  // PROTOCOL_EXECUTION_ENABLED (both require isLive && protocolArmed),
  // so this collapses to a single check. Burn narrative is retired.
  return TRANSFER_ENABLED;
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
 * Production server route that performs LIFE++ balance reads using the
 * server-only RPC (SOLANA_RPC_URL secret). The browser calls THIS instead of
 * opening an RPC Connection directly, so a paid RPC endpoint is never shipped
 * in client JS. Path mirrors app/api/solana/lifepp-balance/route.ts.
 */
export const LIFEPP_BALANCE_API_PATH = "/api/solana/lifepp-balance";

/**
 * Browser-only balance read: fetch the raw LIFE++ balance from the server
 * route. Keeps the same observable contract as the direct read — returns a
 * bigint (0n for a non-existent ATA, which the server maps to "0"), and
 * throws on any failure so the Gatekeeper PoCC layer can fail soft into the
 * "readonly quote unavailable" state.
 */
async function readLifePlusBalanceViaServer(ownerAddress: string): Promise<bigint> {
  const res = await fetch(
    `${LIFEPP_BALANCE_API_PATH}?wallet=${encodeURIComponent(ownerAddress)}`,
    { method: "GET", headers: { accept: "application/json" }, cache: "no-store" }
  );
  type BalanceResponse = { ok?: boolean; rawBalance?: unknown; error?: unknown };
  let data: BalanceResponse | null = null;
  try {
    data = (await res.json()) as BalanceResponse;
  } catch {
    // fall through to the generic failure below
  }
  if (!res.ok || !data || data.ok !== true) {
    const reason =
      data && typeof data.error === "string" ? data.error : `http_${res.status}`;
    throw new Error(`LIFE++ balance read failed: ${reason}`);
  }
  if (typeof data.rawBalance !== "string" || !/^\d+$/.test(data.rawBalance)) {
    throw new Error("LIFE++ balance read failed: malformed_response");
  }
  return BigInt(data.rawBalance);
}

/**
 * Server-side direct-RPC LIFE++ balance read (raw u64, NOT decimal-shifted).
 *
 * `rpcUrlOverride` lets a server route inject an RPC URL it resolved from a
 * server-only source — e.g. the SOLANA_RPC_URL secret read via
 * getCloudflareContext().env. When omitted, resolveRpcUrl() is used.
 *
 * Behavior contract:
 *   - Returns 0n when the wallet's ATA does not exist (brand-new wallet that
 *     has never received LIFE++). Detected by best-effort error-message
 *     inspection — see isAccountNotFoundError below.
 *   - Rethrows on any other RPC failure (network, rate limit, malformed
 *     response).
 *
 * MUST be called only on the server. The browser path is
 * readLifePlusBalanceRaw -> readLifePlusBalanceViaServer so the paid RPC
 * endpoint is never exposed to client JS.
 */
export async function readLifePlusBalanceForOwner(
  ownerAddress: string,
  rpcUrlOverride?: string
): Promise<bigint> {
  if (!isLikelySolanaAddress(ownerAddress)) {
    throw new Error("Solana address validation failed.");
  }

  const conn = getConnection(rpcUrlOverride);
  // allowOwnerOffCurve = true: a balance read must work for ANY owner, incl.
  // off-curve PDAs (the Squads treasury). Previously this threw
  // TokenOwnerOffCurveError (empty .message) for such owners, surfacing as an
  // empty `balance_read_failed` diagnostic. On-curve wallets are unaffected.
  const ataStr = getAssociatedTokenAddress(ownerAddress, getLifePlusMint(), true);
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
 * Read the on-chain LIFE++ balance (raw u64, NOT decimal-shifted) for the
 * given wallet. Environment-aware so the SAME call works safely from both the
 * browser and the server without leaking a paid RPC endpoint:
 *
 *   - Browser: routes through the server endpoint (readLifePlusBalanceViaServer)
 *     so the SOLANA_RPC_URL secret is used server-side and never inlined into
 *     client JS.
 *   - Server (route handlers, scripts): reads the chain directly via
 *     readLifePlusBalanceForOwner.
 *
 * The `connection: WalletConnection` parameter is the dapp-side wallet adapter
 * handle (used only for its `.address`), NOT the Solana RPC connection.
 *
 * Behavior contract is unchanged from the original direct read: 0n for a
 * non-existent ATA; throws on other failures so the Gatekeeper PoCC layer can
 * convert them into a "blocked / readonly quote unavailable" state.
 */
export async function readLifePlusBalanceRaw(
  connection: WalletConnection,
  ownerAddress: string = connection.address
): Promise<bigint> {
  if (!isLikelySolanaAddress(ownerAddress)) {
    throw new Error("Solana address validation failed.");
  }
  // typeof window !== "undefined" is true only in the browser. On the
  // Cloudflare Worker / Node (route handlers, prerender, scripts) window is
  // undefined, so those take the direct-RPC path.
  if (typeof window !== "undefined") {
    return readLifePlusBalanceViaServer(ownerAddress);
  }
  return readLifePlusBalanceForOwner(ownerAddress);
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
