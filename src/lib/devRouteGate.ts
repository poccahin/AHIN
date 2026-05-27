/**
 * Dev-only API route gate.
 *
 * Routes under /api/dev/* expose RPC-backed reads useful for payment
 * rehearsal but inappropriate for production. This module centralizes
 * the env check so the routes themselves stay small, and so the release
 * linter can grep for a single canonical guard.
 *
 * Gate semantics:
 *   - enabled === true  only when:
 *       NEXT_PUBLIC_AHIN_ENV !== "production"  AND
 *       AHIN_ENABLE_DEV_ROUTES === "true"
 *   - In any other case, the route handler MUST return 404 (or similar)
 *     before touching the wrapped logic.
 */

export type DevRouteBlockReason = "production_env" | "explicit_disable";

export interface DevRouteGateResult {
  enabled: boolean;
  reason: "ok" | DevRouteBlockReason;
}

/**
 * Pure variant — takes the env values as arguments so unit tests can
 * exercise each blocker without mutating process.env between cases.
 */
export function devRoutesEnabledFor(
  envName: string | undefined,
  enableFlag: string | undefined
): DevRouteGateResult {
  if (envName?.trim().toLowerCase() === "production") {
    return { enabled: false, reason: "production_env" };
  }
  if (enableFlag !== "true") {
    return { enabled: false, reason: "explicit_disable" };
  }
  return { enabled: true, reason: "ok" };
}

export function devRoutesEnabled(): DevRouteGateResult {
  return devRoutesEnabledFor(
    process.env.NEXT_PUBLIC_AHIN_ENV,
    process.env.AHIN_ENABLE_DEV_ROUTES
  );
}

/**
 * Standard 404 response for blocked dev routes. We use 404 (rather than
 * 403) so the route is indistinguishable from a non-existent path in
 * production — no signal that a debug surface exists at all.
 */
export function devRouteNotFoundResponse(): Response {
  return new Response("Not Found", { status: 404 });
}
