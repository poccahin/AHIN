import { LIFE_PLUS_MINT } from "../config/life-plus";
import { USDC_DECIMALS, USDC_SOLANA_MINT } from "../lib/lifePlusSolana";
import type { LifePlusOracleQuote } from "../lib/jupiterUltra";

export const MIN_HOLDING_USDT_RAW = 10n * 10n ** BigInt(USDC_DECIMALS);
export const COLLABORATION_USDT_RAW = 10n;
export const FALLBACK_ENTRY_LIFE_PLUS = 10_000n;
export const READONLY_QUOTE_UNAVAILABLE = "Readonly quote unavailable. You can continue in readonly evidence mode.";

export interface PoccEntryProof {
  eligible: boolean;
  fallback: boolean;
  lifeBalanceRaw: string;
  lifeDecimals: number;
  valueUsdcRaw: string;
  requiredUsdcRaw: string;
  reason: string;
}

export interface PoccCollaborationFee {
  amountRaw: string;
  amountFormatted: string;
  lifeDecimals: number;
  fallback: boolean;
  reason: string;
}

function isLifePlusQuote(value: unknown): value is LifePlusOracleQuote {
  return Boolean(value && typeof value === "object" && (value as { status?: unknown }).status === "ok");
}

function unwrapLifePlusQuote(value: unknown): LifePlusOracleQuote | null {
  if (isLifePlusQuote(value)) {
    return value;
  }
  if (value && typeof value === "object" && isLifePlusQuote((value as { quote?: unknown }).quote)) {
    return (value as { quote: LifePlusOracleQuote }).quote;
  }
  return null;
}

function asBigInt(value: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid unsigned integer: ${value}`);
  }
  return BigInt(value);
}

function baseUnit(decimals: number) {
  return 10n ** BigInt(decimals);
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) {
    throw new Error("Cannot divide by zero.");
  }
  return (numerator + denominator - 1n) / denominator;
}

export function formatTokenAmount(raw: bigint, decimals: number, precision = 6) {
  const unit = baseUnit(decimals);
  const whole = raw / unit;
  const fraction = raw % unit;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

export async function fetchLifePlusQuote(lifeDecimals = 6): Promise<LifePlusOracleQuote> {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const oracleEndpoint = process.env.NEXT_PUBLIC_AHIN_ORACLE_URL ?? "/api/oracle/jupiter/lifepp";
  const url = oracleEndpoint.startsWith("http") ? new URL(oracleEndpoint) : new URL(oracleEndpoint, origin);
  url.searchParams.set("inputMint", LIFE_PLUS_MINT);
  url.searchParams.set("outputMint", USDC_SOLANA_MINT);
  url.searchParams.set("amount", (10n ** BigInt(lifeDecimals)).toString());
  url.searchParams.set("slippageBps", "50");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });
  const payload = (await response.json().catch(() => null)) as LifePlusOracleQuote | { quote?: LifePlusOracleQuote; error?: string } | null;
  const quote = unwrapLifePlusQuote(payload);
  if (!response.ok || !quote) {
    throw new Error(READONLY_QUOTE_UNAVAILABLE);
  }
  return quote;
}

export function verifyNetworkEntryFromQuote(balanceRaw: bigint, quote: LifePlusOracleQuote): PoccEntryProof {
  const quoteInputRaw = asBigInt(quote.quoteInputRaw);
  const outAmountUsdcRaw = asBigInt(quote.outAmountUsdcRaw);
  if (quoteInputRaw <= 0n || outAmountUsdcRaw <= 0n) {
    throw new Error("Jupiter LIFE++ quote returned a zero amount.");
  }
  const valueUsdcRaw = (balanceRaw * outAmountUsdcRaw) / quoteInputRaw;
  return {
    eligible: valueUsdcRaw >= MIN_HOLDING_USDT_RAW,
    fallback: false,
    lifeBalanceRaw: balanceRaw.toString(),
    lifeDecimals: quote.lifeDecimals,
    valueUsdcRaw: valueUsdcRaw.toString(),
    requiredUsdcRaw: MIN_HOLDING_USDT_RAW.toString(),
    reason: valueUsdcRaw >= MIN_HOLDING_USDT_RAW ? "PoCC threshold verified." : "LIFE++ value is below PoCC entry threshold."
  };
}

export function verifyNetworkEntryFallback(balanceRaw: bigint, lifeDecimals: number): PoccEntryProof {
  const requiredRaw = FALLBACK_ENTRY_LIFE_PLUS * baseUnit(lifeDecimals);
  return {
    eligible: balanceRaw >= requiredRaw,
    fallback: true,
    lifeBalanceRaw: balanceRaw.toString(),
    lifeDecimals,
    valueUsdcRaw: "0",
    requiredUsdcRaw: MIN_HOLDING_USDT_RAW.toString(),
    reason: READONLY_QUOTE_UNAVAILABLE
  };
}

export function calculateCollaborationFeeFromQuote(quote: LifePlusOracleQuote): PoccCollaborationFee {
  const quoteInputRaw = asBigInt(quote.quoteInputRaw);
  const outAmountUsdcRaw = asBigInt(quote.outAmountUsdcRaw);
  if (quoteInputRaw <= 0n || outAmountUsdcRaw <= 0n) {
    throw new Error("Jupiter LIFE++ quote returned a zero amount.");
  }
  const maxRaw = baseUnit(quote.lifeDecimals);
  const dynamicRaw = ceilDiv(COLLABORATION_USDT_RAW * quoteInputRaw, outAmountUsdcRaw);
  const amountRaw = dynamicRaw > maxRaw ? maxRaw : dynamicRaw;
  return {
    amountRaw: amountRaw.toString(),
    amountFormatted: formatTokenAmount(amountRaw, quote.lifeDecimals),
    lifeDecimals: quote.lifeDecimals,
    fallback: false,
    reason: "PoCC collaboration fee quoted by Jupiter Ultra."
  };
}

export function calculateCollaborationFeeFallback(lifeDecimals: number): PoccCollaborationFee {
  const amountRaw = baseUnit(lifeDecimals);
  return {
    amountRaw: amountRaw.toString(),
    amountFormatted: formatTokenAmount(amountRaw, lifeDecimals),
    lifeDecimals,
    fallback: true,
    reason: "Jupiter unavailable; PoCC collaboration fee fell back to 1 LIFE++."
  };
}

export async function verifyNetworkEntry(lifeBalanceRaw: bigint, lifeDecimals: number) {
  try {
    return verifyNetworkEntryFromQuote(lifeBalanceRaw, await fetchLifePlusQuote(lifeDecimals));
  } catch {
    return verifyNetworkEntryFallback(lifeBalanceRaw, lifeDecimals);
  }
}

export async function calculateCollaborationFee(lifeDecimals: number) {
  try {
    return calculateCollaborationFeeFromQuote(await fetchLifePlusQuote(lifeDecimals));
  } catch {
    return calculateCollaborationFeeFallback(lifeDecimals);
  }
}
