import { createRemoteJWKSet, jwtVerify } from "jose";

export interface CloudflareAccessClaims {
  aud: string | string[];
  email?: string;
  sub: string;
  iat: number;
  exp: number;
}

export interface CloudflareAccessSession {
  valid: boolean;
  subject: string | null;
  email: string | null;
  tokenHash: string | null;
  checkedAt: string;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyCloudflareAccessRequest(
  request: Request,
  options: {
    teamDomain: string;
    audience: string;
  }
): Promise<CloudflareAccessSession> {
  const token = request.headers.get("CF-Access-Jwt-Assertion");
  if (!token) {
    return {
      valid: false,
      subject: null,
      email: null,
      tokenHash: null,
      checkedAt: new Date().toISOString()
    };
  }

  const jwks = createRemoteJWKSet(new URL(`${options.teamDomain.replace(/\/$/, "")}/cdn-cgi/access/certs`));
  const verified = await jwtVerify<CloudflareAccessClaims>(token, jwks, {
    audience: options.audience
  });

  return {
    valid: true,
    subject: verified.payload.sub,
    email: verified.payload.email ?? request.headers.get("CF-Access-Authenticated-User-Email"),
    tokenHash: await sha256Hex(token),
    checkedAt: new Date().toISOString()
  };
}
