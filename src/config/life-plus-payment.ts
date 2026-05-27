/**
 * LIFE++ Payment safety configuration — Phase P2P canary layer.
 *
 * Additive on top of the existing AND-of-explicit-env-flags model in
 * src/config/life-plus.ts. The existing TRANSFER_ENABLED stays as the
 * infrastructure-level check (used by mock-gate assertions in hooks).
 *
 * The new isCanaryPaymentAuthorized() function is the per-payment check
 * the LifePaymentModule uses at execute time. It ANDs the existing
 * infrastructure flag with canary-specific gates:
 *
 *   canary_authorized =
 *     INFRASTRUCTURE_TRANSFER_ARMED &&   ← from life-plus.ts
 *     AHIN_PAYMENT_CANARY_ENABLED   &&   ← env-armed
 *     wallet ∈ ALLOWLIST            &&
 *     amount ≤ CAP
 *
 * Public payment is explicitly OFF in this phase. Canary is the only path
 * to a real transfer, and it is mandatorily gated by allowlist + cap.
 */

import {
  TRANSFER_ENABLED as INFRASTRUCTURE_TRANSFER_ARMED,
  PROTOCOL_EXECUTION_ENABLED,
  LIFE_PLUS_MINT as MINT
} from "./life-plus";

export const LIFE_PLUS_MINT = MINT;
export { PROTOCOL_EXECUTION_ENABLED, INFRASTRUCTURE_TRANSFER_ARMED };

/** Canonical Squads multisig treasury — destination for all canary transfers. */
export const AHIN_TREASURY_MULTISIG_ADDRESS =
  "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";

/** Burn narrative was retired — entry fees route to Protocol-Owned Liquidity. */
export const BURN_ENABLED = false;

/**
 * Public payment (anyone-can-broadcast) is OFF in Phase P2P. The only live
 * path is the canary, which has its own gates below. There is no env override
 * to flip this — opening to the public is a separate engineering phase that
 * will require its own audit + code change.
 */
export const PUBLIC_PAYMENT_ENABLED = false;

// ---------------------------------------------------------------------------
// Canary configuration — env-derived
// ---------------------------------------------------------------------------

function parseAllowlist(): readonly string[] {
  const raw = process.env.AHIN_PAYMENT_CANARY_ALLOWLIST?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseMaxRaw(): bigint {
  const raw = process.env.AHIN_PAYMENT_CANARY_MAX_RAW?.trim();
  if (!raw || !/^\d+$/.test(raw)) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

/** Master canary switch. Must be deliberately armed via env. */
export const AHIN_PAYMENT_CANARY_ENABLED =
  process.env.AHIN_PAYMENT_CANARY_ENABLED === "true";

/** Allowlisted wallet base58 pubkeys. Empty = no one authorized. */
export const AHIN_PAYMENT_CANARY_ALLOWLIST: readonly string[] = parseAllowlist();

/**
 * Maximum amount in raw u64 units a single canary payment may transfer.
 * 0n (the default when unset) means "cap not configured" — blocks all
 * canary payments regardless of allowlist status.
 */
export const AHIN_PAYMENT_CANARY_MAX_RAW: bigint = parseMaxRaw();

// ---------------------------------------------------------------------------
// Per-payment authorization
// ---------------------------------------------------------------------------

export interface CanaryAuthorizationCheck {
  wallet: string;
  amountRaw: bigint;
}

export type CanaryBlockReason =
  | "infrastructure_not_armed"
  | "canary_disabled"
  | "wallet_not_allowlisted"
  | "amount_above_cap"
  | "cap_not_configured";

export interface CanaryAuthorizationResult {
  authorized: boolean;
  reason?: CanaryBlockReason;
  details?: Record<string, unknown>;
}

export interface CanaryConfig {
  infrastructureArmed: boolean;
  canaryEnabled: boolean;
  allowlist: readonly string[];
  maxRaw: bigint;
}

/**
 * Pure variant — takes an explicit config rather than reading module
 * globals. Exported so unit tests can exercise every blocker without
 * mutating process.env between cases.
 *
 * Order matters: cheaper / more-explanatory checks first. Unarmed envs
 * report the simpler reason rather than "allowlist empty," etc.
 */
export function isCanaryPaymentAuthorizedWith(
  config: CanaryConfig,
  check: CanaryAuthorizationCheck
): CanaryAuthorizationResult {
  if (!config.infrastructureArmed) {
    return { authorized: false, reason: "infrastructure_not_armed" };
  }
  if (!config.canaryEnabled) {
    return { authorized: false, reason: "canary_disabled" };
  }
  if (config.maxRaw <= 0n) {
    return {
      authorized: false,
      reason: "cap_not_configured",
      details: { hint: "Set AHIN_PAYMENT_CANARY_MAX_RAW to a positive integer." }
    };
  }
  if (!config.allowlist.includes(check.wallet)) {
    return {
      authorized: false,
      reason: "wallet_not_allowlisted",
      details: { wallet: check.wallet, allowlistSize: config.allowlist.length }
    };
  }
  if (check.amountRaw > config.maxRaw) {
    return {
      authorized: false,
      reason: "amount_above_cap",
      details: {
        amountRaw: check.amountRaw.toString(),
        capRaw: config.maxRaw.toString()
      }
    };
  }
  return { authorized: true };
}

/**
 * Env-binding production wrapper. Reads the canary config from the
 * module-level env-derived constants and delegates to the pure variant.
 */
export function isCanaryPaymentAuthorized(
  check: CanaryAuthorizationCheck
): CanaryAuthorizationResult {
  return isCanaryPaymentAuthorizedWith(
    {
      infrastructureArmed: INFRASTRUCTURE_TRANSFER_ARMED,
      canaryEnabled: AHIN_PAYMENT_CANARY_ENABLED,
      allowlist: AHIN_PAYMENT_CANARY_ALLOWLIST,
      maxRaw: AHIN_PAYMENT_CANARY_MAX_RAW
    },
    check
  );
}

/**
 * Human-readable copy for the readiness UI when a canary block is shown.
 * Distinct from the wallet-error copy in paymentErrors.ts — these explain
 * "your environment is not armed for canary," not "your wallet rejected."
 */
export const CANARY_BLOCK_COPY: Record<CanaryBlockReason, string> = {
  infrastructure_not_armed:
    "Transfer infrastructure is not armed. AHIN_PROTOCOL_EXECUTION_ENABLED and AHIN_REAL_USAGE_FEE_TRANSFER must both be true.",
  canary_disabled:
    "Canary payment is not enabled. Set AHIN_PAYMENT_CANARY_ENABLED=true to arm.",
  cap_not_configured:
    "Canary amount cap is not configured. Set AHIN_PAYMENT_CANARY_MAX_RAW.",
  wallet_not_allowlisted:
    "This wallet is not on the canary allowlist. Public payment is not enabled.",
  amount_above_cap: "Requested amount exceeds the canary per-payment cap."
};
