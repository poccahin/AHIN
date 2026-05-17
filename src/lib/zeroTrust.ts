export interface ZeroTrustSession {
  valid: boolean;
  subject: string | null;
  email: string | null;
  tokenHash: string | null;
  checkedAt: string;
}

export async function verifyZeroTrustSession(signal?: AbortSignal): Promise<ZeroTrustSession> {
  const response = await fetch("/api/security/zero-trust/session", {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-AHIN-Gatekeeper": "global"
    },
    signal
  });

  if (!response.ok) {
    return {
      valid: false,
      subject: null,
      email: null,
      tokenHash: null,
      checkedAt: new Date().toISOString()
    };
  }

  const payload = (await response.json()) as Partial<ZeroTrustSession>;
  return {
    valid: Boolean(payload.valid),
    subject: payload.subject ?? null,
    email: payload.email ?? null,
    tokenHash: payload.tokenHash ?? null,
    checkedAt: payload.checkedAt ?? new Date().toISOString()
  };
}

export async function assertServerSession(input: {
  address: string;
  walletId: string;
  rail: string;
  proofTraceId: string;
  entryFeeSignature: string;
  zeroTrustTokenHash: string | null;
}) {
  const response = await fetch("/api/auth/gatekeeper/session", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-AHIN-Gatekeeper": "global"
    },
    body: JSON.stringify(input)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.sessionId) {
    throw new Error(payload?.reason ?? payload?.error ?? "Server gatekeeper session could not be established.");
  }

  return payload as {
    sessionId: string;
    token: string;
    expiresAt: string;
  };
}
