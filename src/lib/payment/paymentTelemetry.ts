/**
 * Payment telemetry — Phase P2P.
 *
 * Lightweight request-ID generation + structured console logging for
 * correlating phases within a single payment attempt. No third-party
 * telemetry in this phase — just enough to grep wrangler tail with.
 *
 * IDs are not cryptographically random — they're collision-resistant
 * enough for the small number of attempts that happen per session.
 */

const ID_RANDOM_BYTES = 6;

function randomShortId(): string {
  // Browser path: crypto.getRandomValues
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const buf = new Uint8Array(ID_RANDOM_BYTES);
    globalThis.crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback (only used in unit tests where crypto may be polyfilled).
  return Math.floor(Math.random() * 0xffffffffff)
    .toString(16)
    .padStart(ID_RANDOM_BYTES * 2, "0");
}

export function newPaymentRequestId(prefix = "pay"): string {
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${randomShortId()}`;
}

export interface PaymentTelemetryRecord {
  requestId: string;
  intentId: string;
  phase: string;
  timestamp: string;
  buildTxId?: string;
  submitId?: string;
  confirmationId?: string;
  details?: Record<string, unknown>;
}

/**
 * Structured payment-phase log. Goes to console.debug (visible in
 * devtools + wrangler tail when WORKER_DEBUG_LOG_LEVEL=debug).
 *
 * Never logs sensitive data — caller is responsible for sanitizing
 * `details` before passing in.
 */
export function logPaymentTelemetry(record: PaymentTelemetryRecord): void {
  // eslint-disable-next-line no-console
  console.debug("[ahin.payment]", record);
}
