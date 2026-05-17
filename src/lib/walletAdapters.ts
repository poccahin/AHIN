import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, custom, type Address, type PublicClient } from "viem";
import { detectWalletProvider } from "../gate/wallet/wallet-detection";
import { mapWalletProviderError, walletErrorMessage } from "../gate/wallet/wallet-errors";
import { SOLANA_RPC_URL } from "./assetConfig";

export type WalletRail = "evm" | "solana";
export type WalletId = "metamask" | "okx_evm" | "binance_evm" | "phantom_solana" | "okx_solana";

export interface Eip1193Provider {
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isBinance?: boolean;
  providers?: Eip1193Provider[];
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface SolanaWalletProvider {
  isPhantom?: boolean;
  isOkxWallet?: boolean;
  publicKey?: PublicKey | { toBase58?: () => string; toString?: () => string };
  connect?: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: PublicKey | { toBase58?: () => string; toString?: () => string } } | void>;
  disconnect?: () => Promise<void>;
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
  publicClient?: PublicClient;
  solanaConnection?: Connection;
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
  const key = value as PublicKey | { toBase58?: () => string; toString?: () => string };
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

    let accounts: Address[];
    try {
      accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
    } catch (error) {
      throw new Error(formatWalletConnectionError(descriptor.label, error));
    }
    const address = accounts[0];
    if (!address) {
      throw new Error(`${descriptor.label} did not return an EVM account.`);
    }

    const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
    return {
      id,
      label: descriptor.label,
      rail: "evm",
      address,
      chainId,
      evmProvider: provider,
      publicClient: createPublicClient({ transport: custom(provider) })
    };
  }

  const provider = getSolanaProvider(id);
  if (!provider?.connect) {
    throw new Error(`${descriptor.label} is not installed or does not support Solana connect.`);
  }

  let connection: Awaited<ReturnType<NonNullable<SolanaWalletProvider["connect"]>>>;
  try {
    connection = await provider.connect({ onlyIfTrusted: false });
  } catch (error) {
    throw new Error(formatWalletConnectionError(descriptor.label, error));
  }
  const address = normalizePublicKey((connection && "publicKey" in connection ? connection.publicKey : null) ?? provider.publicKey);
  if (!address) {
    throw new Error(`${descriptor.label} did not return a Solana public key.`);
  }

  return {
    id,
    label: descriptor.label,
    rail: "solana",
    address,
    chainId: null,
    solanaConnection: new Connection(SOLANA_RPC_URL, "confirmed")
  };
}
