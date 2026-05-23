/**
 * Cloudflare Turnstile server-side verification endpoint.
 *
 * Reads the Turnstile token from the client, POSTs it to Cloudflare's
 * siteverify API with the server-side secret, and returns `{success}`.
 *
 * --------------------------------------------------------------------------
 * Secret access on Cloudflare Workers + OpenNext
 * --------------------------------------------------------------------------
 * On Cloudflare Workers, secrets set via `wrangler secret put` do NOT appear
 * on `process.env` — they live on the Worker's `env` binding. `process.env`
 * only mirrors `vars` from wrangler.workers.jsonc (which get build-time
 * injected). OpenNext exposes the runtime env binding through
 * `getCloudflareContext().env`.
 *
 * We try the Cloudflare context first, then fall back to `process.env` so
 * the same code works for both:
 *   - production Worker (secret on env)
 *   - local `next dev` / static prerender (var on process.env, if set)
 *
 * --------------------------------------------------------------------------
 * REQUIRED SETUP — once, OOB
 * --------------------------------------------------------------------------
 *   npx wrangler secret put TURNSTILE_SECRET_KEY \
 *     --config wrangler.workers.jsonc
 *
 * Do NOT add the secret to wrangler.workers.jsonc's `vars` block; it would
 * be committed to git. Secrets must be set via `wrangler secret put` (or the
 * Cloudflare dashboard) so they stay encrypted at rest.
 *
 * Reference:
 *   https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 *   https://opennext.js.org/cloudflare/howtos/env
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Abort siteverify after this many ms so the worker never hangs on it. */
const SITEVERIFY_TIMEOUT_MS = 8000;

interface SiteverifyResponse {
  success?: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

/**
 * Try the Cloudflare env binding first (where `wrangler secret put` deposits
 * secrets), then fall back to `process.env` (for build-time vars and local
 * dev). Returns undefined if neither source has it.
 */
function readTurnstileSecret(): string | undefined {
  try {
    const ctx = getCloudflareContext();
    // env is typed broadly; cast narrowly to read our key.
    const fromBinding = (ctx?.env as Record<string, unknown> | undefined)?.[
      "TURNSTILE_SECRET_KEY"
    ];
    if (typeof fromBinding === "string" && fromBinding.length > 0) {
      return fromBinding;
    }
  } catch {
    // getCloudflareContext throws when called outside a request handler
    // context (e.g., during static analysis or `next build` prerender).
    // Fall through to process.env so build-time evaluation still works.
  }

  const fromProcess = process.env.TURNSTILE_SECRET_KEY;
  if (typeof fromProcess === "string" && fromProcess.length > 0) {
    return fromProcess;
  }
  return undefined;
}

export async function POST(request: Request): Promise<Response> {
  const secret = readTurnstileSecret();
  if (!secret) {
    console.error(
      "[ahin] TURNSTILE_SECRET_KEY not found on env binding or process.env. " +
        "On Cloudflare Workers, set it via `wrangler secret put " +
        "TURNSTILE_SECRET_KEY --config wrangler.workers.jsonc`."
    );
    return Response.json(
      { success: false, error: "server_misconfigured" },
      { status: 500 }
    );
  }

  // ---- Parse + validate body
  let token: string | undefined;
  try {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body?.token === "string" && body.token.length > 0) {
      token = body.token;
    }
  } catch {
    return Response.json(
      { success: false, error: "invalid_body" },
      { status: 400 }
    );
  }
  if (!token) {
    return Response.json(
      { success: false, error: "missing_token" },
      { status: 400 }
    );
  }

  // ---- Forward to siteverify with timeout
  const params = new URLSearchParams({ secret, response: token });
  // Cloudflare's recommendation: forward the client IP when available so
  // siteverify can score it. CF-Connecting-IP is set automatically by the
  // Cloudflare edge for traffic that's behind the Cloudflare proxy.
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) params.set("remoteip", clientIp);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    SITEVERIFY_TIMEOUT_MS
  );

  try {
    const verifyRes = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal
    });
    clearTimeout(timeoutHandle);

    if (!verifyRes.ok) {
      console.warn("[ahin] siteverify non-2xx", { status: verifyRes.status });
      return Response.json(
        {
          success: false,
          error: "siteverify_http_error",
          status: verifyRes.status
        },
        { status: 502 }
      );
    }

    let data: SiteverifyResponse;
    try {
      data = (await verifyRes.json()) as SiteverifyResponse;
    } catch {
      return Response.json(
        { success: false, error: "siteverify_invalid_json" },
        { status: 502 }
      );
    }

    if (!data.success) {
      // Cloudflare lists the precise reason in error-codes. Log it server-side
      // so failed verifications can be triaged from wrangler tail; don't echo
      // back to the client (potentially leaks abuse signal).
      console.warn("[ahin] siteverify rejected token", {
        errorCodes: data["error-codes"]
      });
      return Response.json({ success: false });
    }

    return Response.json({ success: true });
  } catch (err) {
    clearTimeout(timeoutHandle);
    const aborted =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    if (aborted) {
      console.error("[ahin] siteverify timed out after", SITEVERIFY_TIMEOUT_MS, "ms");
    } else {
      console.error("[ahin] siteverify fetch failed", err);
    }
    return Response.json(
      {
        success: false,
        error: aborted ? "siteverify_timeout" : "siteverify_network"
      },
      { status: 502 }
    );
  }
}
