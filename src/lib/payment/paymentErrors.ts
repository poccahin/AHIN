/**
 * Wallet + payment error classification — Phase P2P.
 *
 * Maps the loose error shapes that come back from Phantom / OKX / Solana
 * RPC / our own preflight checks into a stable union the UI can switch on.
 *
 * Heuristic-based by design: web3.js doesn't expose typed error classes
 * we can instanceof-check across versions, and wallet providers wrap
 * messages inconsistently. We catch the common shapes and fall through
 * to "unknown" for anything we don't recognize.
 */

export type PaymentErrorClass =
  | "user_rejected"
  | "wallet_locked"
  | "wrong_network"
  | "request_pending"
  | "rpc_timeout"
  | "stale_blockhash"
  | "insufficient_sol"
  | "insufficient_life"
  | "missing_source_ata"
  | "missing_treasury_ata"
  | "unknown";

interface ErrorLike {
  code?: unknown;
  name?: unknown;
  message?: unknown;
}

function readField(err: unknown, field: keyof ErrorLike): unknown {
  if (!err || typeof err !== "object") return undefined;
  return (err as Record<string, unknown>)[field as string];
}

/**
 * Classify any thrown value (wallet errors, RPC errors, our own thrown
 * Errors from preflight) into one of the known PaymentErrorClass tags.
 */
export function classifyWalletPaymentError(err: unknown): PaymentErrorClass {
  if (err === null || err === undefined) return "unknown";

  const code = readField(err, "code");
  const name = readField(err, "name");
  const rawMessage = readField(err, "message");
  const message =
    typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";

  // Code-based: Phantom + most EIP-1193-style providers
  if (code === 4001) return "user_rejected";
  if (code === -32002) return "request_pending";

  // DOMException-style timeouts (from AbortController etc.)
  if (name === "AbortError" || name === "TimeoutError") return "rpc_timeout";

  if (!message) return "unknown";

  // ---- Message heuristics ----
  // Order matters: more specific patterns before more general ones.

  // Preflight-issued classes (explicit, from our own code) — match first
  // so callers can construct synthetic Error("missing_treasury_ata")-style
  // throws and have them round-trip.
  if (message.includes("missing_source_ata") || message.includes("no source token account") || (message.includes("could not find account") && message.includes("source"))) {
    return "missing_source_ata";
  }
  if (message.includes("missing_treasury_ata") || message.includes("treasury token account") || (message.includes("could not find account") && message.includes("treasury"))) {
    return "missing_treasury_ata";
  }
  if (message.includes("insufficient_sol") || message.includes("insufficient lamports") || message.includes("insufficient sol")) {
    return "insufficient_sol";
  }
  if (message.includes("insufficient_life") || (message.includes("insufficient") && (message.includes("life++") || message.includes("token balance")))) {
    return "insufficient_life";
  }

  // Wallet-side
  if (message.includes("user rejected") || message.includes("user denied")) return "user_rejected";
  if (message.includes("request already pending") || message.includes("already pending")) return "request_pending";
  if (message.includes("locked")) return "wallet_locked";

  // Network mismatch
  if (message.includes("wrong network") || message.includes("wrong cluster") || message.includes("cluster mismatch")) {
    return "wrong_network";
  }

  // RPC / timing
  if (
    message.includes("blockhash not found") ||
    (message.includes("blockhash") && (message.includes("expired") || message.includes("not found"))) ||
    message.includes("block height exceeded") ||
    message.includes("transaction expired")
  ) {
    return "stale_blockhash";
  }
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("confirmation timeout") ||
    message.includes("aborted")
  ) {
    return "rpc_timeout";
  }

  return "unknown";
}

/**
 * User-facing copy. Stable strings — the test suite asserts on these.
 * Do not mutate without updating tests.
 */
export const PAYMENT_ERROR_COPY: Record<PaymentErrorClass, string> = {
  user_rejected: "Signature cancelled. No LIFE++ was moved.",
  wallet_locked: "Wallet appears locked. Unlock wallet and retry.",
  wrong_network: "Wallet network does not match mainnet-beta.",
  request_pending:
    "Wallet request already pending. Resolve it in the wallet before retrying.",
  rpc_timeout: "RPC confirmation timed out. Check status before retrying.",
  stale_blockhash: "Transaction expired before signing. Rebuild required.",
  insufficient_sol: "Insufficient SOL for network fees.",
  insufficient_life: "Insufficient LIFE++ balance.",
  missing_source_ata: "This wallet has no LIFE++ token account.",
  missing_treasury_ata: "Treasury LIFE++ token account is not ready.",
  unknown: "Payment failed. Please retry."
};

/**
 * Whether an error class should allow the user to retry, vs. requiring
 * intervention (manual support, env change, etc.).
 */
export function isRecoverable(cls: PaymentErrorClass): boolean {
  switch (cls) {
    case "user_rejected":
    case "wallet_locked":
    case "request_pending":
    case "rpc_timeout":
    case "stale_blockhash":
    case "insufficient_sol":
    case "insufficient_life":
    case "unknown":
      return true;
    case "wrong_network":
    case "missing_source_ata":
    case "missing_treasury_ata":
      return false;
  }
}

export function describePaymentError(cls: PaymentErrorClass): string {
  return PAYMENT_ERROR_COPY[cls];
}
