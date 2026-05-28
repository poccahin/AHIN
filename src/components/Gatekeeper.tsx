"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ShieldCheck, Wallet } from "lucide-react";
import { Turnstile } from "@marsidev/react-turnstile";
import { LIFE_PLUS_MINT } from "../config/life-plus";
import LifePaymentModule from "./LifePaymentModule";
import { useEntrySignature } from "../hooks/useEntrySignature";
import { readLifePlusBalanceRaw, readLifePlusDecimals } from "../lib/lifePlusSolana";
import { connectWallet, discoverWallets, formatWalletConnectionError, type WalletConnection, type WalletDescriptor, type WalletId } from "../lib/walletAdapters";
import { detectWalletProviders, type WalletDetectionStatus } from "../gate/wallet/wallet-detection";
import { MOCK_FALLBACK_DISCLOSURE, type MockFallbackState } from "../gate/wallet/mock-fallback";
import { formatTokenAmount, verifyNetworkEntry, type PoccEntryProof } from "../services/poccConsensus";
import { useAuthStore } from "../store/authStore";

interface GatekeeperProps {
  children?: ReactNode;
}

const MOCK_WALLET = "0xAhinReadonlyGate...2026";
// Turnstile siteKey is public by design (lives in client bundles). Configure
// per-environment via NEXT_PUBLIC_TURNSTILE_SITE_KEY; falls back to the
// project siteKey for ahin-io. Set widget appearance/execution mode in the
// Cloudflare dashboard for this siteKey (Invisible for silent UX).
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "0x4AAAAAADUzG7HwBkY8f_O2";
const LIFE_PLUS_MINT_SHORT = `${LIFE_PLUS_MINT.slice(0, 5)}...${LIFE_PLUS_MINT.slice(-4)}`;
const READONLY_QUOTE_UNAVAILABLE = "Readonly quote unavailable. You can continue in readonly evidence mode.";
const AHIN_FOUNDATION_TREASURY_MULTISIG = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";
const LIVE_WALLETS: Array<{ id: WalletId; label: string }> = [
  { id: "phantom_solana", label: "Phantom" },
  { id: "okx_solana", label: "OKX Wallet" },
  { id: "binance_evm", label: "Binance Wallet" },
  { id: "metamask", label: "MetaMask" }
];

type LiveWalletButton = { id: WalletId; label: string; installed: boolean | null; detectionStatus: WalletDetectionStatus | null };

type PoccStatus =
  | { state: "idle"; proof: null; message: string }
  | { state: "checking"; proof: null; message: string }
  | { state: "verified"; proof: PoccEntryProof; message: string }
  | { state: "blocked"; proof: PoccEntryProof | null; message: string };

function formatFallbackState(state: MockFallbackState) {
  const labels: Record<MockFallbackState, string> = {
    wallet_connected_mock: "readonly wallet session prepared",
    asset_detected_mock: "readonly evidence detected",
    signature_verified_mock: "dry-run evidence verified",
    matrix_revealing: "governance console opening",
    matrix_active: "governance console active"
  };
  return labels[state];
}

export default function Gatekeeper({ children }: GatekeeperProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const gateMode = useAuthStore((state) => state.gateMode);
  const grantAccess = useAuthStore((state) => state.grantAccess);
  const { requestEntry, isProcessing, authError } = useEntrySignature();
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [liveConnection, setLiveConnection] = useState<WalletConnection | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [liveWallets, setLiveWallets] = useState<LiveWalletButton[]>(() =>
    LIVE_WALLETS.map((wallet) => ({ ...wallet, installed: null, detectionStatus: null }))
  );
  const [mockFallbackState, setMockFallbackState] = useState<MockFallbackState | null>(null);
  const [poccStatus, setPoccStatus] = useState<PoccStatus>({
    state: "idle",
    proof: null,
    message: "Awaiting wallet proof"
  });
  const fallbackTimers = useRef<number[]>([]);
  const [verified, setVerified] = useState(false);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const connectedAddress = liveConnection?.address ?? connectedWallet;
  // live-readonly (P3A) behaves like live for showing wallet buttons + real
  // balance/PoCC reads, but renders LifePaymentModule in readonly mode and
  // can never arm transfer (isLive in life-plus.ts is strictly "live").
  const liveReadonlyMode = gateMode === "live-readonly";
  const liveGateMode = gateMode === "live" || liveReadonlyMode;
  const mockFallbackEnabled = gateMode === "mock";
  const isLiveSolana = liveGateMode && liveConnection?.rail === "solana";
  const isSolanaPoccVerified = !isLiveSolana || poccStatus.state === "verified";
  const processing = isProcessing;
  const transactionError = authError;

  useEffect(() => {
    return () => {
      fallbackTimers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!liveGateMode) {
      return;
    }
    const discovered = discoverWallets();
    const detection = detectWalletProviders();
    setLiveWallets(
      LIVE_WALLETS.map((wallet) => ({
        ...wallet,
        installed: Boolean(discovered.find((candidate: WalletDescriptor) => candidate.id === wallet.id)?.installed),
        detectionStatus:
          detection.find((candidate) => {
            if (wallet.id === "phantom_solana") return candidate.id === "phantom";
            if (wallet.id === "okx_solana") return candidate.id === "okx";
            if (wallet.id === "binance_evm") return candidate.id === "binance";
            return candidate.id === "metamask";
          })?.status ?? "unknown"
      }))
    );
  }, [liveGateMode]);

  async function continueWithMockVerification() {
    fallbackTimers.current.forEach((timer) => window.clearTimeout(timer));
    fallbackTimers.current = [];
    setWalletError(null);
    setLiveConnection(null);
    setConnectedWallet(MOCK_WALLET);
    setMockFallbackState("wallet_connected_mock");

    const states: MockFallbackState[] = ["asset_detected_mock", "signature_verified_mock", "matrix_revealing"];
    states.forEach((state, index) => {
      const timer = window.setTimeout(() => setMockFallbackState(state), 260 + index * 360);
      fallbackTimers.current.push(timer);
    });

    try {
      const receipt = await requestEntry(MOCK_WALLET);
      if (receipt.confirmed) {
        setMockFallbackState("matrix_active");
        grantAccess(MOCK_WALLET);
      }
    } catch {
      setWalletError("Readonly verification unavailable. You can retry in dry-run evidence mode.");
    }
  }

  async function verifySolanaPocc(connection: WalletConnection) {
    setPoccStatus({ state: "checking", proof: null, message: "Checking PoCC threshold" });
    try {
      const [decimals, balanceRaw] = await Promise.all([readLifePlusDecimals(connection), readLifePlusBalanceRaw(connection)]);
      const proof = await verifyNetworkEntry(balanceRaw, decimals);
      if (proof.fallback) {
        setPoccStatus({ state: "blocked", proof, message: READONLY_QUOTE_UNAVAILABLE });
        setWalletError(READONLY_QUOTE_UNAVAILABLE);
        return;
      }
      setPoccStatus({
        state: proof.eligible ? "verified" : "blocked",
        proof,
        message: proof.eligible
          ? `PoCC threshold verified (${formatTokenAmount(BigInt(proof.lifeBalanceRaw), proof.lifeDecimals)} LIFE++)`
          : proof.reason
      });
      if (!proof.eligible) {
        setWalletError(proof.reason);
      }
    } catch (error) {
      setPoccStatus({ state: "blocked", proof: null, message: READONLY_QUOTE_UNAVAILABLE });
      setWalletError(READONLY_QUOTE_UNAVAILABLE);
    }
  }

  async function connectLiveWallet(walletId: WalletId) {
    setWalletError(null);
    setPoccStatus({ state: "idle", proof: null, message: "Awaiting wallet proof" });
    try {
      const connection = await connectWallet(walletId);
      setLiveConnection(connection);
      setConnectedWallet(connection.address);
      if (connection.rail === "solana") {
        await verifySolanaPocc(connection);
      }
    } catch (error) {
      const walletLabel = LIVE_WALLETS.find((wallet) => wallet.id === walletId)?.label ?? walletId;
      const message = formatWalletConnectionError(walletLabel, error);
      console.error("[ahin.io] Wallet connection failed", { walletId, error });
      setWalletError(message);
    }
  }

  async function enter() {
    if (!connectedAddress) {
      return;
    }
    try {
      if (isLiveSolana) {
        if (!isSolanaPoccVerified) {
          setWalletError("Readonly LIFE++ admission proof is not verified.");
          return;
        }
        grantAccess(connectedAddress);
        return;
      }
      const receipt = await requestEntry(connectedAddress);
      if (receipt.confirmed) {
        grantAccess(connectedAddress);
      }
    } catch {
      // Signature hooks own the user-facing authError state.
    }
  }

  async function onTurnstileSuccess(token: string) {
    setTurnstileError(null);
    try {
      const res = await fetch("/api/verify-turnstile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      if (!res.ok) {
        setVerified(false);
        setTurnstileError("Human verification failed. Please refresh.");
        return;
      }
      const data = (await res.json()) as { success?: boolean };
      if (data.success) {
        setVerified(true);
      } else {
        setVerified(false);
        setTurnstileError("Human verification did not pass. Please refresh.");
      }
    } catch (err) {
      console.error("[ahin] Turnstile verify error", err);
      setVerified(false);
      setTurnstileError("Human verification network error.");
    }
  }

  function onTurnstileExpire() {
    setVerified(false);
  }

  // Gate the 3D scene render on BOTH wallet/PoCC auth AND Turnstile human
  // verification. Either failing keeps the user on the splash.
  if (isAuthenticated && verified) {
    return <>{children}</>;
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,0.08),transparent_30%),radial-gradient(circle_at_18%_18%,rgba(3,169,244,0.11),transparent_30%),radial-gradient(circle_at_84%_18%,rgba(255,87,34,0.09),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.026)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:88px_88px] [mask-image:radial-gradient(circle_at_center,black,transparent_72%)]" />

      {gateMode === "mock" ? (
        <div className="absolute left-4 top-4 z-10 text-[10px] uppercase tracking-[0.22em] text-white/[0.36]">
          READONLY GOVERNANCE MODE / protocol execution disabled
        </div>
      ) : null}

      <section className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10" aria-label="ahin.io readonly governance gatekeeper">
        <div className="grid w-[min(94vw,1040px)] items-stretch gap-5 lg:grid-cols-[minmax(360px,440px)_minmax(360px,1fr)]">
          <div className="w-full rounded-[28px] border border-white/20 bg-white/[0.055] px-6 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_38px_120px_rgba(0,0,0,0.62)] backdrop-blur-[40px] sm:px-8 sm:py-8">
          <div className="mb-8 flex items-start justify-between gap-5">
            <div>
              <p className="mb-2 text-[11px] uppercase text-white/40">Multi-Agent Zero-Trust Network</p>
              <h1 className="text-[48px] font-semibold leading-none text-white sm:text-[64px]">ahin.io</h1>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-[18px] border border-white/20 bg-white/[0.06] text-white/[0.85]">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>

          <div className="mb-5 rounded-2xl border border-white/15 bg-white/[0.045] p-3 text-sm text-white/[0.72]">
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#7dfb8d] shadow-[0_0_14px_rgba(125,251,141,0.88)]" />
              <span>Zero-Trust Tunnel: Secure</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span>{connectedAddress ? connectedAddress : "Wallet session unbound"}</span>
              <strong className="font-medium text-white/[0.88]">
                {mockFallbackState
                  ? formatFallbackState(mockFallbackState)
                  : isLiveSolana
                      ? poccStatus.message
                    : connectedAddress
                      ? "Readonly LIFE++ holding ready"
                      : "Awaiting wallet proof"}
              </strong>
            </div>
          </div>

          {!connectedAddress ? (
            liveGateMode ? (
              <div className="grid grid-cols-2 gap-3">
                {liveWallets.map((wallet) => (
                  <button
                    key={wallet.id}
                    type="button"
                    disabled={wallet.installed === false}
                    onClick={() => connectLiveWallet(wallet.id)}
                    title={wallet.installed === false ? `${wallet.label} is not installed or not exposed to this browser.` : undefined}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-[18px] border border-white/20 bg-white/[0.07] text-sm font-medium text-white/[0.86] transition hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:bg-white/[0.035] disabled:text-white/[0.58]"
                  >
                    <Wallet className="h-4 w-4" aria-hidden="true" />
                    <span>{wallet.label}</span>
                    {wallet.installed === false ? <span className="text-[10px] uppercase text-amber-200/70">Not detected</span> : null}
                    {wallet.detectionStatus === "provider_conflict" ? <span className="text-[10px] uppercase text-amber-200/70">Conflict</span> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={continueWithMockVerification}
                  disabled={processing}
                  className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[18px] border border-white/20 bg-white/[0.07] text-sm font-medium text-white/[0.86] transition hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Wallet className="h-4 w-4" aria-hidden="true" />
                  Enter Governance Console
                </button>
                <p className="text-center text-[11px] leading-5 text-white/[0.42]">
                  Readonly evidence mode. On-chain wallet adapters are not enabled in this build. {MOCK_FALLBACK_DISCLOSURE}
                </p>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/[0.12] bg-white/[0.035] p-4">
                <p className="text-[12px] uppercase text-white/[0.38]">Proof of Assets</p>
                <p className="mt-1 text-sm text-white/[0.82]">
                  {isLiveSolana ? (poccStatus.state === "verified" ? "Readonly LIFE++ holding verified" : poccStatus.message) : "Readonly LIFE++ holding proof ready"}
                </p>
                <div className="mt-3 grid gap-1.5 text-xs leading-5 text-white/[0.46]">
                  <p>Admission threshold: ≥ 10 USDT-equivalent LIFE++</p>
                  <p>LIFE++ mint: {LIFE_PLUS_MINT_SHORT}</p>
                  <p>Quote source: Jupiter readonly</p>
                  <p>No transfer or burn will be executed</p>
                </div>
              </div>
              {isLiveSolana && poccStatus.state === "verified" && liveConnection ? (
                /* Live-Solana + PoCC verified: real on-chain transfer to
                   the canonical Squads multisig treasury. Mock useEntry-
                   Signature path is bypassed. The signature returned by
                   onSuccess threads into the auth session's entryFee. */
                <LifePaymentModule
                  connection={liveConnection}
                  readonly={liveReadonlyMode}
                  onSuccess={(sig) => {
                    grantAccess(connectedAddress, sig);
                  }}
                  onError={(err) => {
                    setWalletError(err.message);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={enter}
                  disabled={processing || (isLiveSolana && !isSolanaPoccVerified)}
                  className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[18px] border border-white/25 bg-white text-sm font-semibold text-[#050505] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-white/[0.12] disabled:text-white/[0.34]"
                >
                  {processing
                    ? "Dry-run proof pending"
                    : isLiveSolana && !isSolanaPoccVerified
                      ? "Verify 10 USDT-equivalent LIFE++ Holding"
                      : "Enter with Dry-Run Proof"}
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {isLiveSolana && poccStatus.state === "blocked" ? (
                <button
                  type="button"
                  onClick={continueWithMockVerification}
                  disabled={processing}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[18px] border border-white/20 bg-white/[0.07] text-sm font-medium text-white/[0.86] transition hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Enter Governance Console
                </button>
              ) : null}
              <p className="text-center text-[11px] leading-5 text-white/[0.42]">{MOCK_FALLBACK_DISCLOSURE}</p>
            </div>
          )}

          {walletError ? <p className="mt-4 text-center text-xs leading-5 text-amber-200">{walletError}</p> : null}
          {transactionError ? <p className="mt-4 text-center text-xs leading-5 text-red-300">{transactionError}</p> : null}
          {mockFallbackEnabled ? (
            <p className="mx-auto mt-5 max-w-[360px] text-center text-[11px] leading-5 text-white/[0.42]">
              Readonly evidence mode. On-chain wallet adapters are not enabled in this build. {MOCK_FALLBACK_DISCLOSURE}
            </p>
          ) : null}
        </div>

          <aside
            className="relative overflow-hidden rounded-[32px] border border-white/15 bg-white/[0.052] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_34px_110px_rgba(0,0,0,0.56)] backdrop-blur-[44px] sm:px-7 lg:self-center"
            aria-label="LIFE++ AHIN governance gate"
          >
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,rgba(3,169,244,0.16),transparent_28%),radial-gradient(circle_at_18%_86%,rgba(255,193,7,0.105),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.075),transparent_38%)]"
            aria-hidden="true"
          />
          <div className="relative">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.055] px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-white/55">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-200 shadow-[0_0_14px_rgba(255,218,150,0.72)]" />
              LIFE++ / AHIN Governance Gate
            </div>

            <div className="mb-6">
              <h2 className="text-[30px] font-semibold leading-[1.02] text-white sm:text-[40px]">
                Phase G1
              </h2>
              <p className="mt-2 text-sm leading-6 text-white/62">Treasury Funding Readiness Evidence</p>
            </div>

            <div className="mb-5 rounded-[24px] border border-white/[0.12] bg-black/[0.18] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]">
              <p className="text-[11px] uppercase tracking-[0.16em] text-white/42">AHIN Foundation Squads multisig</p>
              <p className="mt-2 text-sm font-medium text-white/86">Archived and corrected</p>
              <p className="mt-3 break-all rounded-[18px] border border-white/[0.1] bg-white/[0.045] px-3 py-3 font-mono text-[12px] leading-5 text-sky-100/88">
                {AHIN_FOUNDATION_TREASURY_MULTISIG}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[20px] border border-white/[0.105] bg-white/[0.038] p-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/36">Governance threshold</p>
                <p className="mt-1 text-sm font-medium text-white/84">2-of-3</p>
              </div>
              <div className="rounded-[20px] border border-white/[0.105] bg-white/[0.038] p-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/36">Members</p>
                <p className="mt-1 text-sm font-medium text-white/84">3</p>
              </div>
              <div className="rounded-[20px] border border-white/[0.105] bg-white/[0.038] p-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-white/36">Source</p>
                <p className="mt-1 text-sm font-medium leading-5 text-white/84">Squads dashboard visual confirmation</p>
              </div>
            </div>

            <div className="mt-5 grid gap-2.5 text-[13px] leading-5 text-white/68">
              <div className="flex items-start justify-between gap-4 rounded-[18px] border border-amber-200/15 bg-amber-200/[0.045] px-3 py-2.5">
                <span>Treasury funding</span>
                <strong className="text-right font-medium text-amber-100/90">Blocked pending approval evidence</strong>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-[18px] border border-white/[0.095] bg-white/[0.032] px-3 py-2.5">
                <span>Protocol execution</span>
                <strong className="text-right font-medium text-white/86">Disabled</strong>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-[18px] border border-white/[0.095] bg-white/[0.032] px-3 py-2.5">
                <span>LIFE++ transfer / burn / signing</span>
                <strong className="text-right font-medium text-white/86">Disabled</strong>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-[18px] border border-white/[0.095] bg-white/[0.032] px-3 py-2.5">
                <span>No transaction submission</span>
                <strong className="text-right font-medium text-white/86">Enforced</strong>
              </div>
              <div className="flex items-start justify-between gap-4 rounded-[18px] border border-white/[0.095] bg-white/[0.032] px-3 py-2.5">
                <span>Root domain status</span>
                <strong className="text-right font-medium text-white/86">Active on ahin.io via Cloudflare Pages</strong>
              </div>
            </div>
          </div>
          </aside>
        </div>
      </section>

      {/* Cloudflare Turnstile — invisible human verification. Configured for
          invisible/interaction-only mode in the Cloudflare dashboard for
          this siteKey; if a challenge is required, the widget shows here. */}
      <div className="pointer-events-auto fixed bottom-4 right-4 z-30">
        <Turnstile
          siteKey={TURNSTILE_SITE_KEY}
          onSuccess={onTurnstileSuccess}
          onExpire={onTurnstileExpire}
          options={{ appearance: "interaction-only", theme: "dark" }}
        />
        {turnstileError ? (
          <p className="mt-2 max-w-[260px] text-right text-[11px] leading-5 text-amber-200">{turnstileError}</p>
        ) : null}
      </div>
    </main>
  );
}
