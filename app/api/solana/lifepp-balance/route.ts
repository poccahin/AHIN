/**
 * Production readonly LIFE++ balance endpoint.
 *
 * GET /api/solana/lifepp-balance?wallet=<base58>
 *   -> { ok: true, rawBalance: "<u64>", decimals: <n>, rpcSource: "..." }
 *
 * --------------------------------------------------------------------------
 * Why this route exists (P3A-RPC)
 * --------------------------------------------------------------------------
 * Browser code must NEVER hold a paid RPC endpoint: NEXT_PUBLIC_* vars are
 * inlined into the client bundle at build time, so a Helius/Triton URL with
 * an embedded api-key placed in NEXT_PUBLIC_SOLANA_RPC_URL would leak to every
 * visitor. Instead the browser calls this server route, which resolves the
 * server-only SOLANA_RPC_URL secret and reads the chain server-side. The
 * client receives only the resulting balance — never the RPC URL.
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
 * NEXT_PUBLIC value, then to the lib devnet default. Same pattern as
 * app/api/verify-turnstile/route.ts.
 *
 * REQUIRED SETUP (once, OOB) — do NOT commit the URL to wrangler `vars`:
 *   npx wrangler secret put SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc
 *
 * Reference: https://opennext.js.org/cloudflare/howtos/env
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isLikelySolanaAddress } from "@/src/lib/addressValidation";
import {
  readLifePlusBalanceForOwner,
  readLifePlusDecimals
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
      rpcSource: rpc.source
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        ok: false,
        error: "balance_read_failed",
        // Note: a misconfigured/unreachable RPC surfaces here. The diagnostic
        // is the chain client's error message, which does not include our URL.
        diagnostic: message,
        rpcSource: rpc.source
      },
      { status: 502 }
    );
  }
}
