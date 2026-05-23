/**
 * Cloudflare Turnstile server-side verification endpoint.
 *
 * Receives a Turnstile token from the client (set in the Gatekeeper after
 * `onSuccess`), POSTs it to Cloudflare's siteverify API together with the
 * server-side secret, and returns `{success: boolean}` to the client.
 *
 * REQUIRED ENV: TURNSTILE_SECRET_KEY must be set on the Worker. Set OOB via:
 *
 *   npx wrangler secret put TURNSTILE_SECRET_KEY \
 *     --config wrangler.workers.jsonc
 *
 * (Or via the Cloudflare dashboard for the deployed Worker. Do NOT add the
 * secret to wrangler.workers.jsonc's `vars` block — it would be committed.)
 *
 * Reference: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  success?: boolean;
  "error-codes"?: string[];
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error(
      "[ahin] TURNSTILE_SECRET_KEY not set on the worker. " +
        "Set it via `wrangler secret put TURNSTILE_SECRET_KEY`."
    );
    return Response.json(
      { success: false, error: "server_misconfigured" },
      { status: 500 }
    );
  }

  let token: string | undefined;
  try {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body?.token === "string") token = body.token;
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

  try {
    const params = new URLSearchParams({ secret, response: token });
    // Optional: forward the client IP. Cloudflare exposes it via CF-Connecting-IP
    // on Workers; harmless to omit and not all platforms set it consistently.
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (clientIp) params.set("remoteip", clientIp);

    const verifyRes = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    if (!verifyRes.ok) {
      return Response.json(
        { success: false, error: "siteverify_http_error" },
        { status: 502 }
      );
    }
    const data = (await verifyRes.json()) as SiteverifyResponse;
    return Response.json({ success: Boolean(data.success) });
  } catch (err) {
    console.error("[ahin] siteverify network error", err);
    return Response.json(
      { success: false, error: "siteverify_network" },
      { status: 502 }
    );
  }
}
