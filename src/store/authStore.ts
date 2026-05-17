import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EntryFeeReceipt } from "../hooks/useEntrySignature";
import type { ProofEvaluation } from "../hooks/useProofOfAssets";
import type { WalletConnection } from "../lib/walletAdapters";
import type { ZeroTrustSession } from "../lib/zeroTrust";

export interface AhinSession {
  sessionId: string;
  token: string;
  expiresAt: string;
  wallet: Pick<WalletConnection, "id" | "label" | "rail" | "address" | "chainId">;
  proof: ProofEvaluation;
  entryFee: EntryFeeReceipt;
  zeroTrust: ZeroTrustSession;
  authenticatedAt: string;
}

interface AuthState {
  isAuthenticated: boolean;
  session: AhinSession | null;
  userWallet: string | null;
  gateMode: "mock" | "live";
  grantAccess: (wallet: string) => void;
  revokeAccess: () => void;
  setAuthenticated: (session: AhinSession) => void;
  clearSession: () => void;
}

const FOUNDATION_LIFEPP_ADDRESS = "AbzDBaC9AmG4ve1Jfemi5TFPCGLLcurqzwPaHj9Jidzr";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const resolvedGateMode: AuthState["gateMode"] = process.env.NEXT_PUBLIC_AHIN_GATE_MODE === "live" ? "live" : "mock";

function isSessionLive(session: AhinSession | null) {
  if (!session) {
    return false;
  }
  return session.entryFee.confirmed && new Date(session.expiresAt).getTime() > Date.now();
}

function createMockSession(wallet: string): AhinSession {
  const now = new Date();
  const timestamp = now.toISOString();
  const suffix = Date.now().toString(36);

  return {
    sessionId: `mock-session-${suffix}`,
    token: `mock-token-${suffix}`,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    wallet: {
      id: "phantom_solana",
      label: "Mock Wallet",
      rail: "solana",
      address: wallet,
      chainId: null
    },
    proof: {
      status: "eligible",
      eligible: true,
      lifeppEligible: true,
      mainstreamEligible: true,
      traceId: `mock-proof-${suffix}`,
      rows: [],
      checkedAt: timestamp,
      error: null
    },
    entryFee: {
      rail: "solana",
      walletId: "phantom_solana",
      payer: wallet,
      recipient: FOUNDATION_LIFEPP_ADDRESS,
      asset: "LIFE++",
      amount: "1",
      signature: `mock-lifepp-entry-${suffix}`,
      confirmed: true,
      confirmedAt: timestamp
    },
    zeroTrust: {
      valid: true,
      subject: "mock-zero-trust-subject",
      email: null,
      tokenHash: `mock-zero-trust-${suffix}`,
      checkedAt: timestamp
    },
    authenticatedAt: timestamp
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      session: null,
      userWallet: null,
      gateMode: resolvedGateMode,
      grantAccess: (wallet) => {
        const session = createMockSession(wallet);
        set({
          isAuthenticated: true,
          session,
          userWallet: wallet
        });
      },
      revokeAccess: () =>
        set({
          isAuthenticated: false,
          session: null,
          userWallet: null
        }),
      setAuthenticated: (session) =>
        set({
          isAuthenticated: isSessionLive(session),
          session,
          userWallet: session.wallet.address
        }),
      clearSession: () =>
        set({
          isAuthenticated: false,
          session: null,
          userWallet: null
        })
    }),
    {
      name: "ahin.global-auth.v1",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }
        state.isAuthenticated = isSessionLive(state.session);
        if (!state.isAuthenticated) {
          state.session = null;
          state.userWallet = null;
          return;
        }
        state.userWallet = state.session?.wallet.address ?? null;
        state.gateMode = resolvedGateMode;
      }
    }
  )
);
