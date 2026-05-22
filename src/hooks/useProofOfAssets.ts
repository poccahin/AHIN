import { useCallback, useState } from "react";
import {
  EVM_ASSETS,
  SOLANA_ASSETS,
  USD_DECIMALS,
  baseUnit,
  type AssetConfig,
  type AssetSymbol
} from "../lib/assetConfig";
import { isLikelyEvmAddress, isLikelySolanaAddress } from "../lib/addressValidation";
import type { WalletConnection } from "../lib/walletAdapters";

export type ProofStatus = "idle" | "checking" | "eligible" | "ineligible" | "error";

export interface AssetProofRow {
  symbol: AssetSymbol;
  track: "lifepp" | "mainstream";
  rail: "evm" | "solana";
  balanceRaw: string;
  balanceFormatted: string;
  priceUsdE8: string;
  valueUsdE8: string;
  valueUsdFormatted: string;
  source: "chainlink" | "chainlink-backend" | "stable-parity" | "unconfigured";
  eligible: boolean;
  status: "ok" | "skipped" | "failed";
  reason?: string;
}

export interface ProofEvaluation {
  status: ProofStatus;
  eligible: boolean;
  lifeppEligible: boolean;
  mainstreamEligible: boolean;
  traceId: string;
  rows: AssetProofRow[];
  checkedAt: string | null;
  error: string | null;
}

const initialEvaluation: ProofEvaluation = {
  status: "idle",
  eligible: false,
  lifeppEligible: false,
  mainstreamEligible: false,
  traceId: "",
  rows: [],
  checkedAt: null,
  error: null
};
const ASSET_PROOF_UNAVAILABLE = "Readonly asset proof unavailable. You can continue in readonly evidence mode.";
const READONLY_CLIENTS_REMOVED = "Runtime Web3 clients removed; readonly evidence mode uses local readiness validation only.";

function formatUnits(raw: bigint, decimals: number, precision = 4) {
  const unit = baseUnit(decimals);
  const whole = raw / unit;
  const fraction = raw % unit;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function formatUsdE8(value: bigint) {
  return `$${formatUnits(value, USD_DECIMALS, 2)}`;
}

async function evaluateEvmProof(connection: WalletConnection) {
  if (!isLikelyEvmAddress(connection.address)) {
    throw new Error("Readonly EVM address validation failed.");
  }
  return EVM_ASSETS.map((asset) => failedRow(asset, READONLY_CLIENTS_REMOVED));
}

async function evaluateSolanaProof(connection: WalletConnection) {
  if (!isLikelySolanaAddress(connection.address)) {
    throw new Error("Readonly Solana address validation failed.");
  }
  return SOLANA_ASSETS.map((asset) => failedRow(asset, READONLY_CLIENTS_REMOVED));
}

function okRow(
  asset: AssetConfig,
  balance: bigint,
  price: bigint,
  value: bigint,
  source: AssetProofRow["source"],
  eligible: boolean
): AssetProofRow {
  return {
    symbol: asset.symbol,
    track: asset.track,
    rail: asset.rail,
    balanceRaw: balance.toString(),
    balanceFormatted: formatUnits(balance, asset.decimals),
    priceUsdE8: price.toString(),
    valueUsdE8: value.toString(),
    valueUsdFormatted: formatUsdE8(value),
    source,
    eligible,
    status: "ok"
  };
}

function skippedRow(asset: AssetConfig, reason: string): AssetProofRow {
  return {
    symbol: asset.symbol,
    track: asset.track,
    rail: asset.rail,
    balanceRaw: "0",
    balanceFormatted: "0",
    priceUsdE8: "0",
    valueUsdE8: "0",
    valueUsdFormatted: "$0",
    source: "unconfigured",
    eligible: false,
    status: "skipped",
    reason
  };
}

function failedRow(asset: AssetConfig, error: unknown): AssetProofRow {
  return {
    ...skippedRow(asset, error instanceof Error ? ASSET_PROOF_UNAVAILABLE : String(error || ASSET_PROOF_UNAVAILABLE)),
    status: "failed"
  };
}

function summarize(rows: AssetProofRow[], rail: WalletConnection["rail"], address: string): ProofEvaluation {
  const lifeppEligible = rows.some((row) => row.track === "lifepp" && row.eligible);
  const mainstreamEligible = rows.some((row) => row.track === "mainstream" && row.eligible);
  const eligible = lifeppEligible || mainstreamEligible;
  const checkedAt = new Date().toISOString();

  return {
    status: eligible ? "eligible" : "ineligible",
    eligible,
    lifeppEligible,
    mainstreamEligible,
    traceId: `${rail}:${address}:${checkedAt}`,
    rows,
    checkedAt,
    error: null
  };
}

export function useProofOfAssets() {
  const [evaluation, setEvaluation] = useState<ProofEvaluation>(initialEvaluation);

  const evaluate = useCallback(async (connection: WalletConnection) => {
    setEvaluation((current) => ({ ...current, status: "checking", error: null }));
    try {
      const rows = connection.rail === "evm" ? await evaluateEvmProof(connection) : await evaluateSolanaProof(connection);
      const next = summarize(rows, connection.rail, connection.address);
      setEvaluation(next);
      return next;
    } catch (error) {
      const next: ProofEvaluation = {
        ...initialEvaluation,
        status: "error",
        error: ASSET_PROOF_UNAVAILABLE
      };
      setEvaluation(next);
      return next;
    }
  }, []);

  const reset = useCallback(() => setEvaluation(initialEvaluation), []);

  return {
    ...evaluation,
    evaluate,
    reset
  };
}
