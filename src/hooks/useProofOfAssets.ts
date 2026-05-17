import { useCallback, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import type { Address, PublicClient } from "viem";
import {
  EVM_ASSETS,
  MIN_REQUIRED_USD,
  SOLANA_ASSETS,
  USD_DECIMALS,
  USD_UNIT,
  baseUnit,
  chainlinkUsdFeedAbi,
  erc20Abi,
  type AssetConfig,
  type AssetSymbol
} from "../lib/assetConfig";
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
const ASSET_PROOF_UNAVAILABLE = "Readonly asset proof unavailable. You can continue with mock verification.";

function normalizePriceToUsdE8(answer: bigint, decimals: number) {
  if (answer <= 0n) {
    throw new Error("Chainlink oracle returned a non-positive price.");
  }
  if (decimals === USD_DECIMALS) {
    return answer;
  }
  if (decimals > USD_DECIMALS) {
    return answer / baseUnit(decimals - USD_DECIMALS);
  }
  return answer * baseUnit(USD_DECIMALS - decimals);
}

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

function valueUsdE8(balance: bigint, decimals: number, priceUsdE8: bigint) {
  return (balance * priceUsdE8) / baseUnit(decimals);
}

async function readEvmPriceUsdE8(client: PublicClient, asset: AssetConfig) {
  if (asset.stableUsd) {
    return { price: USD_UNIT, source: "stable-parity" as const };
  }
  if (asset.rail !== "evm" || !asset.chainlinkUsdFeed) {
    return { price: 0n, source: "unconfigured" as const };
  }

  const [feedDecimals, roundData] = await Promise.all([
    client.readContract({
      address: asset.chainlinkUsdFeed,
      abi: chainlinkUsdFeedAbi,
      functionName: "decimals"
    }) as Promise<number>,
    client.readContract({
      address: asset.chainlinkUsdFeed,
      abi: chainlinkUsdFeedAbi,
      functionName: "latestRoundData"
    }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>
  ]);

  return {
    price: normalizePriceToUsdE8(roundData[1], feedDecimals),
    source: "chainlink" as const
  };
}

async function readEvmBalance(client: PublicClient, address: string, asset: AssetConfig) {
  if (asset.rail !== "evm") {
    return 0n;
  }
  if (asset.tokenAddress === "native") {
    return client.getBalance({ address: address as Address });
  }
  if (!asset.tokenAddress) {
    return 0n;
  }
  return client.readContract({
    address: asset.tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as Address]
  }) as Promise<bigint>;
}

async function readSolanaPriceUsdE8(asset: AssetConfig) {
  if (asset.stableUsd) {
    return { price: USD_UNIT, source: "stable-parity" as const };
  }
  if (asset.rail !== "solana" || !asset.chainlinkFeedId) {
    return { price: 0n, source: "unconfigured" as const };
  }

  const params = new URLSearchParams({
    symbol: asset.symbol,
    rail: "solana",
    feedId: asset.chainlinkFeedId
  });
  const response = await fetch(`/api/oracle/chainlink/price?${params.toString()}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      "X-AHIN-Gatekeeper": "global"
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.priceUsdE8) {
    throw new Error(payload?.reason ?? `Missing Chainlink price proof for ${asset.symbol}.`);
  }

  return {
    price: BigInt(payload.priceUsdE8),
    source: "chainlink-backend" as const
  };
}

async function readSolanaBalance(connection: WalletConnection, asset: AssetConfig) {
  if (asset.rail !== "solana" || !connection.solanaConnection) {
    return 0n;
  }
  const owner = new PublicKey(connection.address);
  if (asset.mintAddress === "native") {
    return BigInt(await connection.solanaConnection.getBalance(owner, "confirmed"));
  }
  if (!asset.mintAddress) {
    return 0n;
  }

  const accounts = await connection.solanaConnection.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(asset.mintAddress)
  });

  return accounts.value.reduce((total, account) => {
    const tokenAmount = account.account.data.parsed.info.tokenAmount.amount as string;
    return total + BigInt(tokenAmount);
  }, 0n);
}

async function evaluateEvmProof(connection: WalletConnection) {
  if (!connection.publicClient) {
    throw new Error("EVM public client is not available.");
  }

  const rows = await Promise.all(
    EVM_ASSETS.map(async (asset) => {
      try {
        if (!asset.stableUsd && !asset.chainlinkUsdFeed) {
          return skippedRow(asset, "Chainlink feed is not configured.");
        }
        if (asset.tokenAddress === null) {
          return skippedRow(asset, "Token contract is not configured.");
        }

        const [balance, priceProof] = await Promise.all([
          readEvmBalance(connection.publicClient!, connection.address, asset),
          readEvmPriceUsdE8(connection.publicClient!, asset)
        ]);
        const value = valueUsdE8(balance, asset.decimals, priceProof.price);
        const eligible = value >= MIN_REQUIRED_USD;
        return okRow(asset, balance, priceProof.price, value, priceProof.source, eligible);
      } catch (error) {
        return failedRow(asset, error);
      }
    })
  );

  return rows;
}

async function evaluateSolanaProof(connection: WalletConnection) {
  const rows = await Promise.all(
    SOLANA_ASSETS.map(async (asset) => {
      try {
        if (!asset.stableUsd && !asset.chainlinkFeedId) {
          return skippedRow(asset, "Chainlink feed id is not configured.");
        }
        if (asset.mintAddress === null) {
          return skippedRow(asset, "Token mint is not configured.");
        }

        const [balance, priceProof] = await Promise.all([readSolanaBalance(connection, asset), readSolanaPriceUsdE8(asset)]);
        const value = valueUsdE8(balance, asset.decimals, priceProof.price);
        const eligible = value >= MIN_REQUIRED_USD;
        return okRow(asset, balance, priceProof.price, value, priceProof.source, eligible);
      } catch (error) {
        return failedRow(asset, error);
      }
    })
  );

  return rows;
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

function failedRow(asset: AssetConfig, _error: unknown): AssetProofRow {
  return {
    ...skippedRow(asset, ASSET_PROOF_UNAVAILABLE),
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
