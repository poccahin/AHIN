import type { Connection, Transaction } from "@solana/web3.js";
import { detectWalletProvider } from "../gate/wallet/wallet-detection";
import { mapWalletProviderError, walletErrorMessage } from "../gate/wallet/wallet-errors";
import { isLikelyEvmAddress, isLikelySolanaAddress } from "./addressValidation";

export type WalletRail = "evm" | "solana";
export type WalletId = "metamask" | "okx_evm" | "binance_evm" | "phantom_solana" | "okx_solana";

export interface Eip1193Provider {
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isBinance?: boolean;
  selectedAddress?: string;
  accounts?: string[];
  providers?: Eip1193Provider[];
  request?: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface SolanaWalletProvider {
  isPhantom?: boolean;
  isOkxWallet?: boolean;
  publicKey?: { toBase58?: () => string; toString?: () => string } | string;
  connect?: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toBase58?: () => string; toString?: () => string } | string } | void>;
  disconnect?: () => Promise<void>;
  /**
   * Phase 2 Path B Bridge: optional signing methods exposed by Phantom-
   * compatible providers. We detect at runtime rather than requiring
   * presence — older wallets may not implement signAndSendTransaction.
   */
  signTransaction?: (transaction: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (
    transaction: Transaction
  ) => Promise<string | { signature: string; publicKey?: unknown }>;
}

export interface WalletDescriptor {
  id: WalletId;
  label: string;
  rail: WalletRail;
  installed: boolean;
}

export interface WalletConnection {
  id: WalletId;
  label: string;
  rail: WalletRail;
  address: string;
  chainId: number | null;
  evmProvider?: Eip1193Provider;
  readonlyEvidenceMode: true;
  walletProviderDetected: true;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    BinanceChain?: Eip1193Provider;
    okxwallet?: {
      ethereum?: Eip1193Provider;
      solana?: SolanaWalletProvider;
    };
    solana?: SolanaWalletProvider;
    phantom?: {
      solana?: SolanaWalletProvider;
    };
  }
}

function browserWindow() {
  if (typeof window === "undefined") {
    throw new Error("Wallet adapters require a browser runtime.");
  }
  return window;
}

function evmProviders() {
  const w = browserWindow();
  return [
    ...(w.ethereum?.providers ?? []),
    w.ethereum,
    w.BinanceChain,
    w.okxwallet?.ethereum
  ].filter(Boolean) as Eip1193Provider[];
}

function getEvmProvider(id: WalletId) {
  const providers = evmProviders();
  if (id === "metamask") {
    return providers.find((provider) => provider.isMetaMask) ?? null;
  }
  if (id === "okx_evm") {
    return providers.find((provider) => provider.isOkxWallet) ?? browserWindow().okxwallet?.ethereum ?? null;
  }
  if (id === "binance_evm") {
    return providers.find((provider) => provider.isBinance) ?? browserWindow().BinanceChain ?? null;
  }
  return null;
}

function getSolanaProvider(id: WalletId) {
  const w = browserWindow();
  if (id === "phantom_solana") {
    const provider = w.phantom?.solana ?? w.solana;
    return provider?.isPhantom ? provider : null;
  }
  if (id === "okx_solana") {
    return w.okxwallet?.solana ?? null;
  }
  return null;
}

function normalizePublicKey(value: unknown) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  const key = value as { toBase58?: () => string; toString?: () => string };
  return key.toBase58?.() ?? key.toString?.() ?? null;
}

function parseChainId(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.startsWith("0x") ? Number.parseInt(value, 16) : Number.parseInt(value, 10);
  }
  return null;
}

export function formatWalletConnectionError(walletLabel: string, error: unknown) {
  return `${walletLabel}: ${mapWalletProviderError(error).message}`;
}

/**
 * Lightweight wallet-error classifier for UX retry messaging.
 *
 * Returns a coarse, actionable category so a caller can choose the right
 * recovery hint (retry vs. unlock vs. switch network). Pure + side-effect
 * free; never throws.
 *
 * NOTE: this is intentionally narrow. The live payment flow already uses the
 * richer classifyWalletPaymentError() in src/lib/payment/paymentErrors.ts
 * (which additionally distinguishes request_pending / rpc_timeout /
 * stale_blockhash / insufficient_sol / insufficient_life / missing ATAs).
 * Do NOT replace that hardened, gated path with this helper — the payment
 * execution path must keep its isCanaryPaymentAuthorized + confirmSolana-
 * Transaction gates intact.
 */
export function classifyWalletError(
  err: unknown
): "rejected" | "locked" | "wrong_network" | "unknown" {
  const code =
    err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  const rawMessage =
    err && typeof err === "object" ? (err as { message?: unknown }).message : undefined;
  const message = typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";

  // user rejection: EIP-1193 / Phantom code 4001, or an explicit message.
  if (code === 4001 || message.includes("user rejected")) return "rejected";
  if (message.includes("locked")) return "locked";
  if (message.includes("wrong network") || message.includes("cluster")) {
    return "wrong_network";
  }
  return "unknown";
}

export function discoverWallets(): WalletDescriptor[] {
  if (typeof window === "undefined") {
    return [];
  }

  const phantom = detectWalletProvider("phantom");
  const okx = detectWalletProvider("okx");
  const binance = detectWalletProvider("binance");
  const metamask = detectWalletProvider("metamask");

  return [
    {
      id: "phantom_solana",
      label: "Phantom",
      rail: "solana",
      installed: phantom.status === "available"
    },
    {
      id: "okx_solana",
      label: "OKX Wallet",
      rail: "solana",
      installed: okx.status === "available"
    },
    {
      id: "okx_evm",
      label: "OKX Wallet EVM",
      rail: "evm",
      installed: okx.status === "available"
    },
    {
      id: "binance_evm",
      label: "Binance Wallet",
      rail: "evm",
      installed: binance.status === "available"
    },
    {
      id: "metamask",
      label: "MetaMask",
      rail: "evm",
      installed: metamask.status === "available"
    }
  ];
}

export async function connectWallet(id: WalletId): Promise<WalletConnection> {
  const descriptor = discoverWallets().find((wallet) => wallet.id === id);
  if (!descriptor) {
    throw new Error(`Unknown wallet adapter: ${id}`);
  }
  if (!descriptor.installed) {
    throw new Error(walletErrorMessage("WALLET_NOT_DETECTED"));
  }

  if (descriptor.rail === "evm") {
    const provider = getEvmProvider(id);
    if (!provider) {
      throw new Error(`${descriptor.label} is not installed or not exposed to this page.`);
    }

    const address = provider.selectedAddress ?? provider.accounts?.[0] ?? null;
    if (!address || !isLikelyEvmAddress(address)) {
      throw new Error(`${descriptor.label} did not expose a readonly EVM address. Continue in readonly evidence mode.`);
    }

    const chainId = parseChainId(null);
    return {
      id,
      label: descriptor.label,
      rail: "evm",
      address,
      chainId,
      evmProvider: provider,
      readonlyEvidenceMode: true,
      walletProviderDetected: true
    };
  }

  const provider = getSolanaProvider(id);
  const address = normalizePublicKey(provider?.publicKey);
  if (!provider || !address || !isLikelySolanaAddress(address)) {
    throw new Error(`${descriptor.label} did not expose a readonly Solana public key. Continue in readonly evidence mode.`);
  }

  return {
    id,
    label: descriptor.label,
    rail: "solana",
    address,
    chainId: null,
    readonlyEvidenceMode: true,
    walletProviderDetected: true
  };
}

/**
 * Sign and send a pre-built Solana Transaction via the user's wallet provider.
 *
 * Path B (Bridge): we drive the underlying provider directly
 * (window.phantom.solana / window.okxwallet.solana) without mounting the
 * @solana/wallet-adapter-react context. The caller pre-builds the Transaction
 * (typically with buildUsageFeeTransaction from ./transactionSolana) and
 * passes it in here.
 *
 * Preference order:
 *   1. provider.signAndSendTransaction — one-step UX, fewer wallet prompts.
 *   2. provider.signTransaction + connection.sendRawTransaction — two-step
 *      fallback for wallets that only expose the lower-level signing API.
 *
 * CRITICAL: this function does NOT gate on TRANSFER_ENABLED. Callers MUST
 * check the flag and refuse to invoke it when unarmed. The gate lives at
 * the call site (e.g. LifePaymentModule) so security review can audit it
 * in one place.
 *
 * @returns base58 transaction signature on success.
 * @throws if walletId isn't a Solana wallet, the provider isn't available,
 *         or signing/sending fails (user rejection, RPC failure, etc.).
 */
export async function executeTransaction(
  walletId: WalletId,
  transaction: Transaction,
  connection: Connection
): Promise<string> {
  if (walletId !== "phantom_solana" && walletId !== "okx_solana") {
    throw new Error(
      `executeTransaction: ${walletId} is not a Solana wallet; only Solana signing is supported.`
    );
  }

  const provider = getSolanaProvider(walletId);
  if (!provider) {
    throw new Error(walletErrorMessage("WALLET_NOT_DETECTED"));
  }

  // --- Preferred: one-step sign + send via the wallet ---
  if (typeof provider.signAndSendTransaction === "function") {
    try {
      const result = await provider.signAndSendTransaction(transaction);
      if (typeof result === "string") return result;
      const sig = (result as { signature?: unknown })?.signature;
      if (typeof sig === "string" && sig.length > 0) return sig;
      throw new Error("Wallet returned an unexpected signAndSendTransaction payload.");
    } catch (err) {
      throw new Error(formatWalletConnectionError(walletId, err));
    }
  }

  // --- Fallback: two-step sign-then-send ---
  if (typeof provider.signTransaction === "function") {
    try {
      const signed = await provider.signTransaction(transaction);
      const raw = signed.serialize();
      const signature = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3
      });
      return signature;
    } catch (err) {
      throw new Error(formatWalletConnectionError(walletId, err));
    }
  }

  throw new Error(
    `Wallet ${walletId} does not expose signAndSendTransaction or signTransaction.`
  );
}
