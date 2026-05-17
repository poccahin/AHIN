import { PublicKey } from "@solana/web3.js";
import {
  BURN_ENABLED,
  LIFE_PLUS_MINT,
  PROTOCOL_EXECUTION_ENABLED,
  TRANSFER_ENABLED
} from "../config/life-plus";
import type { WalletConnection } from "./walletAdapters";

export const LIFE_PLUS_CA = LIFE_PLUS_MINT;
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export function getLifePlusMint() {
  return new PublicKey(LIFE_PLUS_CA);
}

export function getAssociatedTokenAddress(owner: PublicKey, mint = getLifePlusMint()) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

export const getAssociatedTokenAddressSync = getAssociatedTokenAddress;

export function isLiveLifePlusTransferEnabled() {
  return TRANSFER_ENABLED && !BURN_ENABLED && PROTOCOL_EXECUTION_ENABLED;
}

export async function readLifePlusDecimals(connection: WalletConnection) {
  const configured = process.env.NEXT_PUBLIC_LIFE_PLUS_DECIMALS;
  if (configured && /^\d+$/.test(configured)) {
    return Number.parseInt(configured, 10);
  }
  if (!connection.solanaConnection) {
    throw new Error("Solana connection is unavailable.");
  }
  const account = await connection.solanaConnection.getParsedAccountInfo(getLifePlusMint(), "confirmed");
  const decimals = account.value?.data && "parsed" in account.value.data ? account.value.data.parsed.info.decimals : null;
  if (!Number.isInteger(decimals)) {
    throw new Error("Unable to read LIFE++ mint decimals.");
  }
  return decimals as number;
}

export async function readLifePlusBalanceRaw(connection: WalletConnection, ownerAddress = connection.address) {
  if (!connection.solanaConnection) {
    throw new Error("Solana connection is unavailable.");
  }
  const owner = new PublicKey(ownerAddress);
  const tokenAccount = getAssociatedTokenAddress(owner);
  const account = await connection.solanaConnection.getAccountInfo(tokenAccount, "confirmed");
  if (!account) {
    return 0n;
  }
  const balance = await connection.solanaConnection.getTokenAccountBalance(tokenAccount, "confirmed");
  return BigInt(balance.value.amount);
}
