/**
 * Production readonly LIFE++ balance endpoint.
 *
 * GET /api/solana/lifepp-balance?wallet=<base58>
 *   -> { ok: true, rawBalance: "<u64>", decimals, rpcSource, cluster,
 *        lifePlusMint, ownerAddressShort, balanceReadStage, diagnosticCode }
 *
 * --------------------------------------------------------------------------
 * Why this route exists (P3A-RPC)
 * --------------------------------------------------------------------------
 * Browser code must NEVER hold a paid RPC endpoint: NEXT_PUBLIC_* vars are
 * inlined into the client bundle at build time, so a Helius/Triton URL with
 * an embedded api-key placed in NEXT_PUBLIC_SOLANA_RPC_URL would leak to every
 * visitor. Instead the browser calls this server route, which resolves the
 * server-only SOLANA_RPC_URL secret and reads the chain server-side. The
 * client receives only the resulting balance + SAFE diagnostics — never the
 * RPC URL, api-key, or raw provider error body.
 *
 * This is NOT a dev route: it is the production balance/eligibility read path
 * for the live-readonly (P3A) gate. It is intentionally readonly and narrow —
 * it only ever reads the LIFE++ associated-token-account balance for the
 * supplied wallet. It does NOT sign, build, submit, or broadcast anything.
 *
 * --------------------------------------------------------------------------
 * Secret access on Cloudflare Workers + OpenNext
 * --------------------------------------------------------------------------
 * Secrets set via `wrangler secret put` do NOT appear on process.env — they
 * live on the Worker's `env` binding. process.env only mirrors wrangler
 * `vars`. We read the env binding via getCloudflareContext().env first, then
 * fall back to process.env (local dev / var-based config), then to the public
 * NEXT_PUBLIC value, then to the lib devnet default.
 *
 * REQUIRED SETUP (once, OOB) — do NOT commit the URL to wrangler `vars`:
 *   npx wrangler secret put SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc
 * The endpoint must permit Cloudflare Worker egress — the public
 * api.mainnet-beta.solana.com (and some providers) return 403
 * "Your IP or provider is blocked from this endpoint" to Worker IPs.
 *
 * Reference: https://opennext.js.org/cloudflare/howtos/env
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isLikelySolanaAddress } from "@/src/lib/addressValidation";
import {
  readLifePlusBalanceForOwner,
  readLifePlusDecimals,
  getLifePlusMint
} from "@/src/lib/lifePlusSolana";

interface ResolvedRpc {
  url: string | undefined;
  /** Coarse source label — safe to return to the client (never the URL). */
  source: "secret_binding" | "process_env" | "public_env" | "default_devnet";
}

/**
 * Resolve the RPC URL the server should use, preferring the server-only
 * secret. We deliberately surface only a coarse `source` label to callers and
 * NEVER echo the URL itself (it may contain an api-key).
 */
function resolveServerRpcUrl(): ResolvedRpc {
  try {
    const ctx = getCloudflareContext();
    const fromBinding = (ctx?.env as Record<string, unknown> | undefined)?.[
      "SOLANA_RPC_URL"
    ];
    if (typeof fromBinding === "string" && fromBinding.trim().length > 0) {
      return { url: fromBinding.trim(), source: "secret_binding" };
    }
  } catch {
    // getCloudflareContext throws outside a request handler (build/prerender).
    // Fall through to process.env so build-time evaluation still works.
  }

  const fromProcess = process.env.SOLANA_RPC_URL?.trim();
  if (fromProcess && fromProcess.length > 0) {
    return { url: fromProcess, source: "process_env" };
  }

  const fromPublic = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (fromPublic && fromPublic.length > 0) {
    return { url: fromPublic, source: "public_env" };
  }

  // url undefined -> readLifePlusBalanceForOwner falls back to the lib default.
  return { url: undefined, source: "default_devnet" };
}

/** Coarse cluster label (safe — a public NEXT_PUBLIC var). */
function resolveCluster(): string {
  return process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || "unknown";
}

/**
 * Redact anything URL-shaped so an RPC endpoint (which may embed an api-key)
 * can never appear in a response OR a server log line.
 */
function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"'\\]+/gi, "[redacted-url]");
}

function shortOwner(addr: string): string {
  return addr.length <= 10 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type BalanceDiagnosticCode =
  | "rpc_403_forbidden"
  | "rpc_429_rate_limited"
  | "rpc_timeout"
  | "rpc_request_failed"
  | "rpc_invalid_response"
  | "owner_has_no_token_account"
  | "invalid_owner_pubkey"
  | "token_account_query_failed";

/**
 * Map a thrown balance-read error to a SAFE, coarse diagnostic. Returns only a
 * stable code, a curated secret-free message, the error CLASS name (safe), and
 * which stage failed. Never the RPC URL, api-key, or raw provider body.
 */
function classifyBalanceReadError(err: unknown): {
  code: BalanceDiagnosticCode;
  message: string;
  stage: "ata_derivation" | "rpc_query";
  errorClass: string;
} {
  const errorClass =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name ?? "Error")
      : "Error";
  const raw =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : String(err ?? "");
  const m = raw.toLowerCase();

  // Off-curve / invalid owner — thrown during ATA derivation, before any RPC.
  if (
    errorClass === "TokenOwnerOffCurveError" ||
    m.includes("off curve") ||
    m.includes("owner off curve")
  ) {
    return {
      code: "invalid_owner_pubkey",
      message:
        "Owner is off-curve (e.g. a PDA / Squads multisig); ATA derivation rejected it.",
      stage: "ata_derivation",
      errorClass
    };
  }
  if (
    m.includes("invalid public key") ||
    m.includes("non-base58") ||
    m.includes("invalid param: invalid public key")
  ) {
    return {
      code: "invalid_owner_pubkey",
      message: "Owner public key is invalid.",
      stage: "ata_derivation",
      errorClass
    };
  }
  // RPC-stage failures.
  if (
    m.includes("403") ||
    m.includes("forbidden") ||
    m.includes("blocked from this endpoint")
  ) {
    return {
      code: "rpc_403_forbidden",
      message:
        "RPC endpoint returned 403 — the SOLANA_RPC_URL endpoint is blocking this Worker's IP/provider. Point the secret at a provider that permits Cloudflare Worker egress (not the public api.mainnet-beta endpoint).",
      stage: "rpc_query",
      errorClass
    };
  }
  if (
    m.includes("429") ||
    m.includes("too many requests") ||
    m.includes("rate limit")
  ) {
    return {
      code: "rpc_429_rate_limited",
      message: "RPC endpoint rate-limited the request (429).",
      stage: "rpc_query",
      errorClass
    };
  }
  if (
    errorClass === "AbortError" ||
    errorClass === "TimeoutError" ||
    m.includes("timeout") ||
    m.includes("timed out")
  ) {
    return {
      code: "rpc_timeout",
      message: "RPC request timed out.",
      stage: "rpc_query",
      errorClass
    };
  }
  if (
    m.includes("could not find account") ||
    m.includes("account does not exist") ||
    m.includes("account not found")
  ) {
    return {
      code: "owner_has_no_token_account",
      message: "Owner has no LIFE++ associated-token account.",
      stage: "rpc_query",
      errorClass
    };
  }
  if (
    m.includes("fetch failed") ||
    m.includes("network") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("socket")
  ) {
    return {
      code: "rpc_request_failed",
      message: "RPC request failed at the transport layer (network/DNS).",
      stage: "rpc_query",
      errorClass
    };
  }
  if (
    m.includes("unexpected") ||
    m.includes("invalid response") ||
    m.includes("failed to deserialize") ||
    m.includes("json")
  ) {
    return {
      code: "rpc_invalid_response",
      message: "RPC returned an invalid or unexpected response.",
      stage: "rpc_query",
      errorClass
    };
  }
  return {
    code: "token_account_query_failed",
    message: "LIFE++ token-account balance query failed.",
    stage: "rpc_query",
    errorClass
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");

  if (!wallet) {
    return Response.json(
      {
        ok: false,
        error: "missing_wallet_param",
        diagnostic: "Pass ?wallet=<base58 Solana address>"
      },
      { status: 400 }
    );
  }

  if (!isLikelySolanaAddress(wallet)) {
    return Response.json(
      {
        ok: false,
        error: "invalid_wallet_address",
        diagnostic: "Address failed isLikelySolanaAddress() shape check."
      },
      { status: 400 }
    );
  }

  const rpc = resolveServerRpcUrl();

  // P3A production REQUIRES a server-side RPC secret. If neither the env
  // binding nor process.env carries SOLANA_RPC_URL, fail soft with a clear
  // readonly error instead of silently serving reads from the public
  // (rate-limited) fallback as if they were production-grade. Local dev
  // (NEXT_PUBLIC_AHIN_ENV !== "production") keeps the public/devnet fallback.
  const serverSecretConfigured =
    rpc.source === "secret_binding" || rpc.source === "process_env";
  const isProduction =
    (process.env.NEXT_PUBLIC_AHIN_ENV ?? "").trim().toLowerCase() === "production";
  if (isProduction && !serverSecretConfigured) {
    return Response.json(
      {
        ok: false,
        error: "rpc_not_configured",
        diagnostic:
          "SOLANA_RPC_URL secret is not configured on this Worker. Set it via " +
          "`wrangler secret put SOLANA_RPC_URL` for production mainnet reads. " +
          "Readonly quote unavailable.",
        diagnosticCode: "rpc_not_configured",
        rpcSource: rpc.source,
        cluster: resolveCluster(),
        ownerAddressShort: shortOwner(wallet)
      },
      { status: 503 }
    );
  }

  try {
    const [rawBalance, decimals] = await Promise.all([
      readLifePlusBalanceForOwner(wallet, rpc.url),
      readLifePlusDecimals()
    ]);

    return Response.json({
      ok: true,
      rawBalance: rawBalance.toString(),
      decimals,
      // Coarse label only — the resolved RPC URL is intentionally NOT returned
      // because it may carry an api-key.
      rpcSource: rpc.source,
      // P3A debug-safe fields (no secrets):
      cluster: resolveCluster(),
      lifePlusMint: getLifePlusMint(),
      ownerAddressShort: shortOwner(wallet),
      balanceReadStage: "complete",
      diagnosticCode: null
    });
  } catch (err) {
    const c = classifyBalanceReadError(err);
    // Server-side ONLY: full (URL-redacted) detail for `wrangler tail`. Never
    // sent to the client.
    console.error("[ahin] lifepp-balance read failed", {
      diagnosticCode: c.code,
      balanceReadStage: c.stage,
      errorClass: c.errorClass,
      detail: redactUrls(err instanceof Error ? err.message : String(err))
    });
    return Response.json(
      {
        ok: false,
        error: "balance_read_failed",
        // Curated, secret-free message (NOT the raw provider body).
        diagnostic: c.message,
        diagnosticCode: c.code,
        errorClass: c.errorClass, // class name only — safe, no secrets
        balanceReadStage: c.stage,
        rpcSource: rpc.source,
        cluster: resolveCluster(),
        lifePlusMint: getLifePlusMint(),
        ownerAddressShort: shortOwner(wallet)
      },
      { status: 502 }
    );
  }
}
