/**
 * Payment intent persistence — Phase P2P in-flight recovery.
 *
 * Persists the in-progress payment metadata to localStorage so a browser
 * refresh during signing doesn't strand the user. On next page load,
 * LifePaymentModule reads this record and either:
 *   - re-runs confirmation polling if a signature is present
 *   - prompts the user before resuming if not
 *
 * NEVER calls grantAccess on its own. Recovery only confirms what
 * already happened on chain.
 *
 * SSR-safe: every accessor guards against missing window.
 */

const STORAGE_KEY = "ahin.lifeppPaymentIntentInFlight";

/** Records older than this are considered stale and silently cleared. */
const MAX_INTENT_AGE_MS = 30 * 60 * 1000;

export type PaymentIntentStatus =
  | "preflight"
  | "building"
  | "awaiting_signature"
  | "submitted"
  | "confirming"
  | "confirmed";

export interface PaymentIntentRecord {
  intentId: string;
  wallet: string;
  expectedAmountRaw: string;
  treasuryAta: string;
  builtAt: string;
  signature?: string;
  status: PaymentIntentStatus;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function savePaymentIntent(record: PaymentIntentRecord): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Quota / private mode — silent.
  }
}

export function loadPaymentIntent(): PaymentIntentRecord | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PaymentIntentRecord>;
    if (
      typeof parsed?.intentId !== "string" ||
      typeof parsed?.wallet !== "string" ||
      typeof parsed?.builtAt !== "string" ||
      typeof parsed?.status !== "string"
    ) {
      return null;
    }
    return parsed as PaymentIntentRecord;
  } catch {
    return null;
  }
}

export function clearPaymentIntent(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isIntentStale(record: PaymentIntentRecord): boolean {
  const builtAt = new Date(record.builtAt).getTime();
  if (Number.isNaN(builtAt)) return true;
  return Date.now() - builtAt > MAX_INTENT_AGE_MS;
}
