import assert from "node:assert/strict";
import {
  classifyWalletPaymentError,
  PAYMENT_ERROR_COPY,
  isRecoverable,
  type PaymentErrorClass
} from "../src/lib/payment/paymentErrors";
import {
  isCanaryPaymentAuthorizedWith,
  PUBLIC_PAYMENT_ENABLED,
  BURN_ENABLED,
  CANARY_BLOCK_COPY,
  type CanaryConfig
} from "../src/config/life-plus-payment";
import { devRoutesEnabledFor } from "../src/lib/devRouteGate";

// ---------------------------------------------------------------------------
// classifyWalletPaymentError — all PaymentErrorClass cases
// ---------------------------------------------------------------------------

// Phantom-style EIP-1193 codes
assert.equal(classifyWalletPaymentError({ code: 4001 }), "user_rejected");
assert.equal(classifyWalletPaymentError({ code: -32002 }), "request_pending");

// Common message phrases
assert.equal(
  classifyWalletPaymentError({ message: "User rejected the request" }),
  "user_rejected"
);
assert.equal(
  classifyWalletPaymentError({ message: "Request already pending" }),
  "request_pending"
);
assert.equal(
  classifyWalletPaymentError({ message: "Wallet is locked" }),
  "wallet_locked"
);
assert.equal(
  classifyWalletPaymentError({ message: "Wrong network selected" }),
  "wrong_network"
);
assert.equal(
  classifyWalletPaymentError({ message: "cluster mismatch" }),
  "wrong_network"
);

// AbortError name → rpc_timeout
assert.equal(classifyWalletPaymentError({ name: "AbortError" }), "rpc_timeout");
assert.equal(classifyWalletPaymentError({ name: "TimeoutError" }), "rpc_timeout");
assert.equal(
  classifyWalletPaymentError({ message: "Confirmation timeout exceeded" }),
  "rpc_timeout"
);

// Stale blockhash variants
assert.equal(
  classifyWalletPaymentError({ message: "Blockhash not found" }),
  "stale_blockhash"
);
assert.equal(
  classifyWalletPaymentError({ message: "Transaction expired before being committed" }),
  "stale_blockhash"
);
assert.equal(
  classifyWalletPaymentError({ message: "block height exceeded" }),
  "stale_blockhash"
);

// Preflight-class messages (round-trip-friendly)
assert.equal(
  classifyWalletPaymentError({ message: "insufficient_sol" }),
  "insufficient_sol"
);
assert.equal(
  classifyWalletPaymentError({ message: "Insufficient lamports for fee" }),
  "insufficient_sol"
);
assert.equal(
  classifyWalletPaymentError({ message: "insufficient_life" }),
  "insufficient_life"
);
assert.equal(
  classifyWalletPaymentError({ message: "missing_source_ata" }),
  "missing_source_ata"
);
assert.equal(
  classifyWalletPaymentError({ message: "missing_treasury_ata" }),
  "missing_treasury_ata"
);

// Fallthrough → unknown
assert.equal(classifyWalletPaymentError(undefined), "unknown");
assert.equal(classifyWalletPaymentError(null), "unknown");
assert.equal(classifyWalletPaymentError(""), "unknown");
assert.equal(
  classifyWalletPaymentError({ message: "Random unrelated error" }),
  "unknown"
);

// ---------------------------------------------------------------------------
// isRecoverable — wallet/RPC issues retry, environment issues don't
// ---------------------------------------------------------------------------

assert.equal(isRecoverable("user_rejected"), true);
assert.equal(isRecoverable("wallet_locked"), true);
assert.equal(isRecoverable("request_pending"), true);
assert.equal(isRecoverable("rpc_timeout"), true);
assert.equal(isRecoverable("stale_blockhash"), true);
assert.equal(isRecoverable("insufficient_sol"), true);
assert.equal(isRecoverable("insufficient_life"), true);
assert.equal(isRecoverable("unknown"), true);
assert.equal(isRecoverable("wrong_network"), false);
assert.equal(isRecoverable("missing_source_ata"), false);
assert.equal(isRecoverable("missing_treasury_ata"), false);

// ---------------------------------------------------------------------------
// PAYMENT_ERROR_COPY — every class has user-facing text
// ---------------------------------------------------------------------------

const errorClasses: PaymentErrorClass[] = [
  "user_rejected",
  "wallet_locked",
  "wrong_network",
  "request_pending",
  "rpc_timeout",
  "stale_blockhash",
  "insufficient_sol",
  "insufficient_life",
  "missing_source_ata",
  "missing_treasury_ata",
  "unknown"
];
for (const cls of errorClasses) {
  assert.ok(
    PAYMENT_ERROR_COPY[cls] && PAYMENT_ERROR_COPY[cls].length > 0,
    `Missing copy for ${cls}`
  );
}

// Spec-mandated phrasing
assert.match(PAYMENT_ERROR_COPY.user_rejected, /Signature cancelled\./);
assert.match(PAYMENT_ERROR_COPY.user_rejected, /No LIFE\+\+ was moved\./);
assert.match(PAYMENT_ERROR_COPY.wrong_network, /mainnet-beta/);
assert.match(PAYMENT_ERROR_COPY.missing_treasury_ata, /Treasury LIFE\+\+/);
assert.match(PAYMENT_ERROR_COPY.insufficient_sol, /Insufficient SOL/);
assert.match(PAYMENT_ERROR_COPY.insufficient_life, /Insufficient LIFE\+\+/);
assert.match(PAYMENT_ERROR_COPY.stale_blockhash, /Rebuild required/);

// ---------------------------------------------------------------------------
// isCanaryPaymentAuthorizedWith — each blocker + happy path
// ---------------------------------------------------------------------------

const sampleAllowedWallet = "AAAAhinTestAllowlistedWalletPubkey0000000000";
const sampleBlockedWallet = "ZZZZhinTestNonAllowlistedWalletPubkey00000000";

const armedConfig: CanaryConfig = {
  infrastructureArmed: true,
  canaryEnabled: true,
  allowlist: [sampleAllowedWallet],
  maxRaw: 1_000_000n
};

// Authorized happy path
{
  const result = isCanaryPaymentAuthorizedWith(armedConfig, {
    wallet: sampleAllowedWallet,
    amountRaw: 500_000n
  });
  assert.equal(result.authorized, true);
  assert.equal(result.reason, undefined);
}

// Edge: amountRaw exactly equal to cap is authorized
{
  const result = isCanaryPaymentAuthorizedWith(armedConfig, {
    wallet: sampleAllowedWallet,
    amountRaw: 1_000_000n
  });
  assert.equal(result.authorized, true);
}

// Infrastructure not armed (existing AND-of-env-flags model preserved)
{
  const result = isCanaryPaymentAuthorizedWith(
    { ...armedConfig, infrastructureArmed: false },
    { wallet: sampleAllowedWallet, amountRaw: 500_000n }
  );
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "infrastructure_not_armed");
}

// Canary not enabled
{
  const result = isCanaryPaymentAuthorizedWith(
    { ...armedConfig, canaryEnabled: false },
    { wallet: sampleAllowedWallet, amountRaw: 500_000n }
  );
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "canary_disabled");
}

// Cap not configured (maxRaw = 0n)
{
  const result = isCanaryPaymentAuthorizedWith(
    { ...armedConfig, maxRaw: 0n },
    { wallet: sampleAllowedWallet, amountRaw: 1n }
  );
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "cap_not_configured");
}

// Non-allowlisted wallet cannot send
{
  const result = isCanaryPaymentAuthorizedWith(armedConfig, {
    wallet: sampleBlockedWallet,
    amountRaw: 500_000n
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "wallet_not_allowlisted");
}

// Amount above cap cannot send
{
  const result = isCanaryPaymentAuthorizedWith(armedConfig, {
    wallet: sampleAllowedWallet,
    amountRaw: 1_000_001n
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, "amount_above_cap");
}

// Order: infrastructure check fires before canary check
{
  const result = isCanaryPaymentAuthorizedWith(
    { ...armedConfig, infrastructureArmed: false, canaryEnabled: false },
    { wallet: sampleAllowedWallet, amountRaw: 500_000n }
  );
  assert.equal(result.reason, "infrastructure_not_armed");
}

// CANARY_BLOCK_COPY has every reason
const blockReasons = [
  "infrastructure_not_armed",
  "canary_disabled",
  "wallet_not_allowlisted",
  "amount_above_cap",
  "cap_not_configured"
] as const;
for (const reason of blockReasons) {
  assert.ok(
    CANARY_BLOCK_COPY[reason] && CANARY_BLOCK_COPY[reason].length > 0,
    `Missing canary block copy for ${reason}`
  );
}

// ---------------------------------------------------------------------------
// PUBLIC_PAYMENT_ENABLED + BURN_ENABLED — must stay off in this phase
// ---------------------------------------------------------------------------

assert.equal(PUBLIC_PAYMENT_ENABLED, false);
assert.equal(BURN_ENABLED, false);

// ---------------------------------------------------------------------------
// devRoutesEnabledFor — env behavior matrix
// ---------------------------------------------------------------------------

// Production env blocks even when explicit flag is set
assert.deepEqual(devRoutesEnabledFor("production", "true"), {
  enabled: false,
  reason: "production_env"
});
// Case-insensitive production match
assert.deepEqual(devRoutesEnabledFor("PRODUCTION", "true"), {
  enabled: false,
  reason: "production_env"
});
// Whitespace tolerance
assert.deepEqual(devRoutesEnabledFor("  Production  ", "true"), {
  enabled: false,
  reason: "production_env"
});

// Non-production env without the explicit flag blocks
assert.deepEqual(devRoutesEnabledFor("development", undefined), {
  enabled: false,
  reason: "explicit_disable"
});
assert.deepEqual(devRoutesEnabledFor("preview", "false"), {
  enabled: false,
  reason: "explicit_disable"
});
assert.deepEqual(devRoutesEnabledFor(undefined, undefined), {
  enabled: false,
  reason: "explicit_disable"
});

// Non-production env with explicit flag enables
assert.deepEqual(devRoutesEnabledFor("development", "true"), {
  enabled: true,
  reason: "ok"
});
assert.deepEqual(devRoutesEnabledFor("preview", "true"), {
  enabled: true,
  reason: "ok"
});
assert.deepEqual(devRoutesEnabledFor(undefined, "true"), {
  enabled: true,
  reason: "ok"
});

// ---------------------------------------------------------------------------
// Phase P3A — live-readonly mainnet readonly-UI invariants
// ---------------------------------------------------------------------------
import {
  wouldTransferBeArmed,
  LIVE_READONLY_MODE
} from "../src/config/life-plus-payment";

// CORE P3A SAFETY: live-readonly can NEVER arm transfer, even if both
// protocol + transfer flags are true. Only exactly "live" can.
assert.equal(wouldTransferBeArmed("live-readonly", true, true), false);
assert.equal(LIVE_READONLY_MODE, "live-readonly");

// Exactly "live" with both flags armed is the only path to true.
assert.equal(wouldTransferBeArmed("live", true, true), true);

// Any missing flag keeps it disarmed.
assert.equal(wouldTransferBeArmed("live", false, true), false); // protocol off
assert.equal(wouldTransferBeArmed("live", true, false), false); // transfer off
assert.equal(wouldTransferBeArmed("mock", true, true), false); // mock
assert.equal(wouldTransferBeArmed("live-readonly", false, false), false);

// Readonly path still blocks canary (infra not armed under live-readonly,
// which produces infrastructureArmed=false):
assert.equal(
  isCanaryPaymentAuthorizedWith(
    { infrastructureArmed: false, canaryEnabled: true, allowlist: [sampleAllowedWallet], maxRaw: 1_000_000n },
    { wallet: sampleAllowedWallet, amountRaw: 1n }
  ).reason,
  "infrastructure_not_armed"
);

// Burn + public payment remain disabled regardless of mode.
assert.equal(PUBLIC_PAYMENT_ENABLED, false);
assert.equal(BURN_ENABLED, false);

console.log("Phase P2P payment canary hardening tests passed");
console.log("Phase P3A live-readonly transfer-disarm invariants passed");
