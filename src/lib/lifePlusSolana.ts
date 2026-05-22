import {
  BURN_ENABLED,
  LIFE_PLUS_MINT,
  PROTOCOL_EXECUTION_ENABLED,
  TRANSFER_ENABLED
} from "../config/life-plus";
import { isLikelySolanaAddress } from "./addressValidation";
import type { WalletConnection } from "./walletAdapters";

export const LIFE_PLUS_CA = LIFE_PLUS_MINT;
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

export function getLifePlusMint() {
  return LIFE_PLUS_CA;
}

export function getAssociatedTokenAddress(ownerAddress: string, mint = getLifePlusMint()) {
  if (!isLikelySolanaAddress(ownerAddress) || !isLikelySolanaAddress(mint)) {
    throw new Error("Readonly Solana address validation failed.");
  }
  return `readonly-associated-token:${ownerAddress.slice(0, 8)}:${mint.slice(0, 8)}`;
}

export const getAssociatedTokenAddressSync = getAssociatedTokenAddress;

export function isLiveLifePlusTransferEnabled() {
  return TRANSFER_ENABLED && !BURN_ENABLED && PROTOCOL_EXECUTION_ENABLED;
}

export async function readLifePlusDecimals(_connection?: WalletConnection) {
  const configured = process.env.NEXT_PUBLIC_LIFE_PLUS_DECIMALS;
  if (configured && /^\d+$/.test(configured)) {
    return Number.parseInt(configured, 10);
  }
  return 9;
}

export async function readLifePlusBalanceRaw(connection: WalletConnection, ownerAddress = connection.address): Promise<bigint> {
  if (!isLikelySolanaAddress(ownerAddress)) {
    throw new Error("Readonly Solana address validation failed.");
  }
  throw new Error("Readonly LIFE++ balance check unavailable without runtime Web3 clients.");
}
