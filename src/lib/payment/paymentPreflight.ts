/**
 * Mainnet payment preflight checks — Phase P2P.
 *
 * Runs before the LifePaymentModule will sign-and-broadcast a real
 * transfer. Validates every predictable failure mode in one round-trip
 * so the user gets a clear blocker instead of a raw RPC error after
 * already signing.
 *
 * NOT called on the dry-run path (INFRASTRUCTURE_TRANSFER_ARMED=false).
 * That path doesn't need balance/ATA checks because it never broadcasts.
 *
 * IMPORTANT: This module does NOT create a missing treasury ATA. If the
 * treasury LIFE++ ATA does not exist on mainnet, preflight blocks with
 * missing_treasury_ata. ATA creation is a separate, separately-approved
 * operation against the multisig.
 */

import {
  Connection,
  type PublicKey
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { WalletConnection } from "../walletAdapters";
import type { PaymentErrorClass } from "./paymentErrors";

/** Reserve some lamports for the network fee. ~5000 lamports per signature. */
export const SOL_FEE_RESERVE_LAMPORTS = 10_000n;

/** Known genesis hashes per cluster. Used for cluster verification. */
const KNOWN_GENESIS = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"
} as const;

export type ExpectedCluster = keyof typeof KNOWN_GENESIS;

export interface PreflightChecks {
  solBalanceOk: boolean;
  solBalanceLamports: string;
  lifeBalanceOk: boolean;
  lifeBalanceRaw: string;
  sourceAtaExists: boolean;
  sourceAtaAddress: string;
  treasuryAtaExists: boolean;
  treasuryAtaAddress: string;
  clusterMatches: boolean;
  observedClusterGenesis: string | null;
  expectedCluster: string;
  latestBlockhash: {
    blockhash: string;
    lastValidBlockHeight: number;
  } | null;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightChecks;
  /** First failure found — the user-facing blocker. */
  blocker?: PaymentErrorClass;
  /** Non-blocking warnings (e.g. low SOL but technically sufficient). */
  warnings: string[];
}

export interface PreflightParams {
  connection: Connection;
  wallet: WalletConnection;
  walletPubkey: PublicKey;
  treasuryPubkey: PublicKey;
  mint: PublicKey;
  feeAmountRaw: bigint;
  expectedCluster: string;
}

/**
 * Run all preflight checks in parallel and return a structured result.
 *
 * The function never throws on RPC failures — it captures them as
 * negative check values so the caller can map them to user-facing copy.
 */
export async function runPaymentPreflight(
  params: PreflightParams
): Promise<PreflightResult> {
  const {
    connection,
    walletPubkey,
    treasuryPubkey,
    mint,
    feeAmountRaw,
    expectedCluster
  } = params;
  const warnings: string[] = [];

  // ATAs are deterministic — derive synchronously. Off-curve flag matches
  // buildUsageFeeTransaction: source must be on-curve, treasury is a PDA
  // (Squads multisig vault).
  const sourceAta = getAssociatedTokenAddressSync(mint, walletPubkey, false);
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasuryPubkey, true);

  // Parallel RPC fan-out.
  const [
    solBalance,
    sourceAtaInfo,
    treasuryAtaInfo,
    lifeBalanceFetch,
    latestBlockhashFetch,
    genesisHashFetch
  ] = await Promise.all([
    connection.getBalance(walletPubkey).catch(() => null),
    connection.getAccountInfo(sourceAta).catch(() => null),
    connection.getAccountInfo(treasuryAta).catch(() => null),
    connection.getTokenAccountBalance(sourceAta).catch(() => null),
    connection.getLatestBlockhash("confirmed").catch(() => null),
    connection.getGenesisHash().catch(() => null)
  ]);

  // SOL fee reserve
  const solLamports = solBalance == null ? -1n : BigInt(solBalance);
  const solBalanceOk =
    solBalance !== null && solLamports >= SOL_FEE_RESERVE_LAMPORTS;

  // LIFE++ balance — only valid if source ATA exists
  const sourceAtaExists = sourceAtaInfo !== null;
  const lifeBalanceRaw =
    sourceAtaExists && lifeBalanceFetch
      ? BigInt(lifeBalanceFetch.value.amount)
      : 0n;
  const lifeBalanceOk = sourceAtaExists && lifeBalanceRaw >= feeAmountRaw;

  // Treasury ATA — explicit existence check
  const treasuryAtaExists = treasuryAtaInfo !== null;

  // Cluster verification via genesis hash
  const expectedGenesis =
    (KNOWN_GENESIS as Record<string, string>)[expectedCluster] ?? null;
  const observedClusterGenesis = genesisHashFetch ?? null;
  const clusterMatches =
    expectedGenesis !== null &&
    observedClusterGenesis !== null &&
    observedClusterGenesis === expectedGenesis;

  const checks: PreflightChecks = {
    solBalanceOk,
    solBalanceLamports: solLamports.toString(),
    lifeBalanceOk,
    lifeBalanceRaw: lifeBalanceRaw.toString(),
    sourceAtaExists,
    sourceAtaAddress: sourceAta.toBase58(),
    treasuryAtaExists,
    treasuryAtaAddress: treasuryAta.toBase58(),
    clusterMatches,
    observedClusterGenesis,
    expectedCluster,
    latestBlockhash: latestBlockhashFetch
      ? {
          blockhash: latestBlockhashFetch.blockhash,
          lastValidBlockHeight: latestBlockhashFetch.lastValidBlockHeight
        }
      : null
  };

  // Soft warning: SOL is fine but low.
  if (solBalanceOk && solLamports < SOL_FEE_RESERVE_LAMPORTS * 3n) {
    warnings.push("Low SOL balance — may not cover retries.");
  }

  // Determine the first blocker (order = severity for the user).
  // Cluster mismatch first — everything else is moot if we're on the wrong chain.
  let blocker: PaymentErrorClass | undefined;
  if (!checks.clusterMatches) blocker = "wrong_network";
  else if (!checks.latestBlockhash) blocker = "rpc_timeout";
  else if (!checks.sourceAtaExists) blocker = "missing_source_ata";
  else if (!checks.treasuryAtaExists) blocker = "missing_treasury_ata";
  else if (!checks.solBalanceOk) blocker = "insufficient_sol";
  else if (!checks.lifeBalanceOk) blocker = "insufficient_life";

  return { ok: blocker === undefined, checks, blocker, warnings };
}
