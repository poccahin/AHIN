export type WalletId = "phantom" | "okx" | "binance" | "metamask";

export type WalletDetectionStatus =
  | "available"
  | "not_detected"
  | "provider_conflict"
  | "browser_unsupported"
  | "unknown";

export interface WalletDetectionResult {
  id: WalletId;
  status: WalletDetectionStatus;
  label: string;
  detail: string;
}

type MaybeProvider = Record<string, unknown>;

interface WalletWindow {
  ethereum?: MaybeProvider & { providers?: MaybeProvider[]; isMetaMask?: boolean };
  BinanceChain?: MaybeProvider;
  binanceWallet?: MaybeProvider;
  okxwallet?: MaybeProvider;
  okxWallet?: MaybeProvider;
  solana?: MaybeProvider & { isPhantom?: boolean };
  phantom?: { solana?: MaybeProvider & { isPhantom?: boolean } };
}

const WALLET_LABELS: Record<WalletId, string> = {
  phantom: "Phantom",
  okx: "OKX Wallet",
  binance: "Binance Wallet",
  metamask: "MetaMask"
};

function walletWindow(): WalletWindow | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window as unknown as WalletWindow;
}

function hasProvider(provider: unknown) {
  return Boolean(provider && typeof provider === "object");
}

function detectMetaMask(w: WalletWindow): WalletDetectionStatus {
  const providers = Array.isArray(w.ethereum?.providers) ? w.ethereum.providers : [];
  const metamaskProviders = providers.filter((provider) => Boolean((provider as { isMetaMask?: boolean }).isMetaMask));
  if (metamaskProviders.length > 1) {
    return "provider_conflict";
  }
  if (w.ethereum?.isMetaMask || metamaskProviders.length === 1) {
    return "available";
  }
  if (hasProvider(w.ethereum) && providers.length > 0) {
    return "provider_conflict";
  }
  return "not_detected";
}

export function detectWalletProvider(id: WalletId): WalletDetectionResult {
  const w = walletWindow();
  if (!w) {
    return {
      id,
      label: WALLET_LABELS[id],
      status: "browser_unsupported",
      detail: "Wallet providers require a browser runtime."
    };
  }

  let status: WalletDetectionStatus = "unknown";
  if (id === "phantom") {
    status = w.phantom?.solana || w.solana?.isPhantom ? "available" : "not_detected";
  } else if (id === "metamask") {
    status = detectMetaMask(w);
  } else if (id === "okx") {
    status = w.okxwallet || w.okxWallet ? "available" : "not_detected";
  } else if (id === "binance") {
    status = w.BinanceChain || w.binanceWallet ? "available" : "not_detected";
  }

  return {
    id,
    label: WALLET_LABELS[id],
    status,
    detail: status === "available" ? `${WALLET_LABELS[id]} provider detected.` : `${WALLET_LABELS[id]} provider is not available.`
  };
}

export function detectWalletProviders(ids: readonly WalletId[] = ["phantom", "okx", "binance", "metamask"]) {
  return ids.map((id) => detectWalletProvider(id));
}
