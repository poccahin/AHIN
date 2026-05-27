/**
 * Dev-only Solana transaction-build smoke endpoint — Phase 2 rehearsal.
 *
 * GET /api/dev/lifepp-buildtx?wallet=<base58>[&amount=<rawU64>]
 *
 * Exercises src/lib/transactionSolana#buildUsageFeeTransaction over the wire:
 *   1. Validates the wallet pubkey.
 *   2. Builds a Transaction transferring `amount` raw units of LIFE++ from
 *      the wallet's ATA to the canonical Squads multisig treasury ATA.
 *   3. Serializes the Transaction into a JSON-safe payload (Solana types
 *      contain BigInts and PublicKeys; raw JSON.stringify cannot handle
 *      them). Returns programId, keys, and hex-encoded instruction data
 *      so a Solana tx decoder can independently validate the shape.
 *
 * Does NOT sign, send, or broadcast — the only RPC call is
 * getLatestBlockhash inside buildUsageFeeTransaction.
 *
 * REMOVE BEFORE MAINNET. Public read endpoint that pings RPC; harmless
 * on devnet but shouldn't ride along to production.
 */

import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import { isLikelySolanaAddress } from "@/src/lib/addressValidation";
import { buildUsageFeeTransaction } from "@/src/lib/transactionSolana";
import { devRoutesEnabled, devRouteNotFoundResponse } from "@/src/lib/devRouteGate";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const TREASURY_ADDRESS = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";
const DEFAULT_FEE_AMOUNT_RAW = 1_000_000n; // 0.001 LIFE++ at 9 decimals

/** TransferChecked discriminator in the SPL Token program. */
const IX_TRANSFER_CHECKED = 12;

interface SerializedInstruction {
  programId: string;
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: {
    length: number;
    hex: string;
    decoded?: {
      type: "TransferChecked";
      amount: string;
      decimals: number;
    };
  };
}

function maybeDecodeTransferChecked(
  data: Buffer
): SerializedInstruction["data"]["decoded"] | undefined {
  if (data.length < 10) return undefined;
  if (data[0] !== IX_TRANSFER_CHECKED) return undefined;
  return {
    type: "TransferChecked",
    amount: data.readBigUInt64LE(1).toString(),
    decimals: data.readUInt8(9)
  };
}

function serializeTransaction(tx: Transaction): {
  recentBlockhash: string | null;
  feePayer: string | null;
  instructionsCount: number;
  instructions: SerializedInstruction[];
} {
  return {
    recentBlockhash: tx.recentBlockhash ?? null,
    feePayer: tx.feePayer?.toBase58() ?? null,
    instructionsCount: tx.instructions.length,
    instructions: tx.instructions.map((ix) => {
      const dataBuf = Buffer.isBuffer(ix.data) ? ix.data : Buffer.from(ix.data);
      return {
        programId: ix.programId.toBase58(),
        keys: ix.keys.map((k) => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable
        })),
        data: {
          length: dataBuf.length,
          hex: dataBuf.toString("hex"),
          decoded: maybeDecodeTransferChecked(dataBuf)
        }
      };
    })
  };
}

function parseAmountParam(raw: string | null): bigint | { error: string } {
  if (raw === null) return DEFAULT_FEE_AMOUNT_RAW;
  if (!/^\d+$/.test(raw)) {
    return { error: "amount must be a non-negative integer (raw u64)" };
  }
  try {
    const v = BigInt(raw);
    if (v <= 0n) return { error: "amount must be > 0" };
    return v;
  } catch {
    return { error: "amount could not be parsed as bigint" };
  }
}

export async function GET(request: Request): Promise<Response> {
  // Gate: dev routes must never serve in production.
  if (!devRoutesEnabled().enabled) {
    return devRouteNotFoundResponse();
  }

  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const amountRaw = url.searchParams.get("amount");
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL;

  if (!wallet) {
    return Response.json(
      {
        ok: false,
        error: "missing_wallet_param",
        diagnostic: "Pass ?wallet=<base58 Solana address>"
      },
      { status: 400 }
    );
  }
  if (!isLikelySolanaAddress(wallet)) {
    return Response.json(
      {
        ok: false,
        wallet,
        rpcUrl,
        error: "invalid_wallet_address",
        diagnostic: "Address failed isLikelySolanaAddress() shape check."
      },
      { status: 400 }
    );
  }

  const parsedAmount = parseAmountParam(amountRaw);
  if (typeof parsedAmount === "object" && "error" in parsedAmount) {
    return Response.json(
      {
        ok: false,
        wallet,
        rpcUrl,
        error: "invalid_amount_param",
        diagnostic: parsedAmount.error
      },
      { status: 400 }
    );
  }
  const feeAmountRaw = parsedAmount as bigint;

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await buildUsageFeeTransaction({
      connection,
      walletPubkey: new PublicKey(wallet),
      treasuryPubkey: new PublicKey(TREASURY_ADDRESS),
      feeAmountRaw
    });

    return Response.json({
      ok: true,
      request: {
        wallet,
        rpcUrl,
        treasuryAddress: TREASURY_ADDRESS,
        feeAmountRaw: feeAmountRaw.toString()
      },
      transaction: serializeTransaction(tx),
      diagnostic:
        "Build-only rehearsal. No signature requested, no broadcast performed. " +
        "The returned blockhash is from a live RPC call; the rest of the shape " +
        "is deterministic from inputs."
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        ok: false,
        wallet,
        rpcUrl,
        error: "build_failed",
        diagnostic: message,
        hint:
          "If the failure is 'failed to get recent blockhash: fetch failed', " +
          "the worker can't reach the RPC. Verify NEXT_PUBLIC_SOLANA_RPC_URL " +
          "is reachable from the Cloudflare Worker (devnet public RPC is " +
          "rate-limited; consider Helius/Triton)."
      },
      { status: 502 }
    );
  }
}
