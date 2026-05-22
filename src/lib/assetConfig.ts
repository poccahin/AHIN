export type AssetRail = "evm" | "solana";
export type AssetTrack = "lifepp" | "mainstream";
export type AssetSymbol = "LIFE++" | "BTC" | "SOL" | "ETH" | "USDT" | "USDC" | "USDG";
export type EvmAddress = `0x${string}`;

export interface EvmAssetConfig {
  rail: "evm";
  symbol: AssetSymbol;
  track: AssetTrack;
  decimals: number;
  tokenAddress: EvmAddress | "native" | null;
  chainlinkUsdFeed: EvmAddress | null;
  stableUsd?: boolean;
}

export interface SolanaAssetConfig {
  rail: "solana";
  symbol: AssetSymbol;
  track: AssetTrack;
  decimals: number;
  mintAddress: string | "native" | null;
  chainlinkFeedId: string | null;
  stableUsd?: boolean;
}

export type AssetConfig = EvmAssetConfig | SolanaAssetConfig;

export const FOUNDATION_SOLANA_ADDRESS = "AbzDBaC9AmG4ve1Jfemi5TFPCGLLcurqzwPaHj9Jidzr";
export const USD_DECIMALS = 8;
export const USD_UNIT = 10n ** BigInt(USD_DECIMALS);
export const MIN_REQUIRED_USD = 10n * USD_UNIT;

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const env: Record<string, string | undefined> = {
  ...process.env,
  ...viteEnv
};

function optionalEnv(key: string) {
  const nextPublicKey = key.startsWith("VITE_") ? `NEXT_PUBLIC_${key.slice("VITE_".length)}` : key;
  const value = env[key] ?? env[nextPublicKey];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function isEvmAddress(value: string): value is EvmAddress {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function optionalAddress(key: string): EvmAddress | null {
  const value = optionalEnv(key);
  return value && isEvmAddress(value) ? value : null;
}

function optionalNumber(key: string, fallback: number) {
  const value = optionalEnv(key);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function baseUnit(decimals: number) {
  return 10n ** BigInt(decimals);
}

export const EVM_ASSETS: EvmAssetConfig[] = [
  {
    rail: "evm",
    symbol: "LIFE++",
    track: "lifepp",
    decimals: optionalNumber("VITE_LIFEPP_EVM_DECIMALS", 18),
    tokenAddress: optionalAddress("VITE_LIFEPP_EVM_TOKEN_ADDRESS"),
    chainlinkUsdFeed: optionalAddress("VITE_CHAINLINK_LIFEPP_USD_FEED")
  },
  {
    rail: "evm",
    symbol: "ETH",
    track: "mainstream",
    decimals: 18,
    tokenAddress: "native",
    chainlinkUsdFeed: optionalAddress("VITE_CHAINLINK_ETH_USD_FEED")
  },
  {
    rail: "evm",
    symbol: "BTC",
    track: "mainstream",
    decimals: optionalNumber("VITE_WBTC_DECIMALS", 8),
    tokenAddress: optionalAddress("VITE_WBTC_TOKEN_ADDRESS"),
    chainlinkUsdFeed: optionalAddress("VITE_CHAINLINK_BTC_USD_FEED")
  },
  {
    rail: "evm",
    symbol: "SOL",
    track: "mainstream",
    decimals: optionalNumber("VITE_WSOL_EVM_DECIMALS", 9),
    tokenAddress: optionalAddress("VITE_WSOL_EVM_TOKEN_ADDRESS"),
    chainlinkUsdFeed: optionalAddress("VITE_CHAINLINK_SOL_USD_FEED")
  },
  {
    rail: "evm",
    symbol: "USDT",
    track: "mainstream",
    decimals: optionalNumber("VITE_USDT_DECIMALS", 6),
    tokenAddress: optionalAddress("VITE_USDT_TOKEN_ADDRESS"),
    chainlinkUsdFeed: optionalAddress("VITE_CHAINLINK_USDT_USD_FEED"),
    stableUsd: true
  },
  {
    rail: "evm",
    symbol: "USDC",
    track: "mainstream",
    decimals: optionalNumber("VITE_USDC_DECIMALS", 6),
    tokenAddress: optionalAddress("VITE_USDC_TOKEN_ADDRESS"),
    chainlinkUsdFeed: optionalAddress("VITE_CHAINLINK_USDC_USD_FEED"),
    stableUsd: true
  },
  {
    rail: "evm",
    symbol: "USDG",
    track: "mainstream",
    decimals: optionalNumber("VITE_USDG_DECIMALS", 6),
    tokenAddress: optionalAddress("VITE_USDG_TOKEN_ADDRESS"),
    chainlinkUsdFeed: optionalAddress("VITE_CHAINLINK_USDG_USD_FEED"),
    stableUsd: true
  }
];

export const SOLANA_ASSETS: SolanaAssetConfig[] = [
  {
    rail: "solana",
    symbol: "LIFE++",
    track: "lifepp",
    decimals: optionalNumber("VITE_LIFEPP_SOLANA_DECIMALS", 9),
    mintAddress: optionalEnv("VITE_LIFEPP_SOLANA_MINT"),
    chainlinkFeedId: optionalEnv("VITE_CHAINLINK_SOLANA_LIFEPP_USD_FEED")
  },
  {
    rail: "solana",
    symbol: "SOL",
    track: "mainstream",
    decimals: 9,
    mintAddress: "native",
    chainlinkFeedId: optionalEnv("VITE_CHAINLINK_SOL_USD_FEED")
  },
  {
    rail: "solana",
    symbol: "BTC",
    track: "mainstream",
    decimals: optionalNumber("VITE_SOLANA_WBTC_DECIMALS", 8),
    mintAddress: optionalEnv("VITE_SOLANA_WBTC_MINT"),
    chainlinkFeedId: optionalEnv("VITE_CHAINLINK_SOLANA_BTC_USD_FEED")
  },
  {
    rail: "solana",
    symbol: "ETH",
    track: "mainstream",
    decimals: optionalNumber("VITE_SOLANA_WETH_DECIMALS", 8),
    mintAddress: optionalEnv("VITE_SOLANA_WETH_MINT"),
    chainlinkFeedId: optionalEnv("VITE_CHAINLINK_SOLANA_ETH_USD_FEED")
  },
  {
    rail: "solana",
    symbol: "USDT",
    track: "mainstream",
    decimals: optionalNumber("VITE_SOLANA_USDT_DECIMALS", 6),
    mintAddress: optionalEnv("VITE_SOLANA_USDT_MINT"),
    chainlinkFeedId: optionalEnv("VITE_CHAINLINK_SOLANA_USDT_USD_FEED"),
    stableUsd: true
  },
  {
    rail: "solana",
    symbol: "USDC",
    track: "mainstream",
    decimals: optionalNumber("VITE_SOLANA_USDC_DECIMALS", 6),
    mintAddress: optionalEnv("VITE_SOLANA_USDC_MINT"),
    chainlinkFeedId: optionalEnv("VITE_CHAINLINK_SOLANA_USDC_USD_FEED"),
    stableUsd: true
  },
  {
    rail: "solana",
    symbol: "USDG",
    track: "mainstream",
    decimals: optionalNumber("VITE_SOLANA_USDG_DECIMALS", 6),
    mintAddress: optionalEnv("VITE_SOLANA_USDG_MINT"),
    chainlinkFeedId: optionalEnv("VITE_CHAINLINK_SOLANA_USDG_USD_FEED"),
    stableUsd: true
  }
];

export const SOLANA_RPC_URL = optionalEnv("VITE_SOLANA_RPC_URL") ?? "https://api.mainnet-beta.solana.com";
export const LIFEPP_SOLANA_MINT = optionalEnv("VITE_LIFEPP_SOLANA_MINT");
export const LIFEPP_SOLANA_DECIMALS = optionalNumber("VITE_LIFEPP_SOLANA_DECIMALS", 9);
export const LIFEPP_EVM_TOKEN_ADDRESS = optionalAddress("VITE_LIFEPP_EVM_TOKEN_ADDRESS");
export const LIFEPP_EVM_DECIMALS = optionalNumber("VITE_LIFEPP_EVM_DECIMALS", 18);
export const LIFEPP_EVM_FOUNDATION_ADDRESS = optionalAddress("VITE_LIFEPP_EVM_FOUNDATION_ADDRESS");
