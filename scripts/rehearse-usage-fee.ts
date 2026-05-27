/**
 * Devnet build-only rehearsal of buildUsageFeeTransaction.
 *
 * Constructs a usage-fee transfer transaction with a freshly generated
 * dummy payer and the canonical Squads multisig treasury as destination,
 * then prints the instruction shape so we can audit the
 * createTransferCheckedInstruction layout before any real wallet ever
 * signs anything.
 *
 * Does NOT sign, send, or broadcast — the only RPC call is
 * getLatestBlockhash inside buildUsageFeeTransaction.
 *
 *   npx tsx scripts/rehearse-usage-fee.ts
 */

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { buildUsageFeeTransaction } from "../src/lib/transactionSolana";
import { LIFE_PLUS_MINT } from "../src/config/life-plus";
import { readLifePlusDecimals } from "../src/lib/lifePlusSolana";

/** Stub blockhash for offline inspection. NOT a valid recent blockhash —
 *  used only when the live RPC fetch is unavailable. The instruction
 *  shape (the thing we're auditing here) doesn't depend on this value. */
const STUB_BLOCKHASH = "11111111111111111111111111111111";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
  "https://api.devnet.solana.com";
const TREASURY_ADDRESS = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";

/** SPL Token program. */
const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** SPL Associated Token Account program. */
const SPL_ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** TransferChecked instruction discriminator in the SPL Token program. */
const IX_TRANSFER_CHECKED = 12;

function describeProgramId(id: string): string {
  if (id === SPL_TOKEN_PROGRAM_ID) return " (SPL Token)";
  if (id === SPL_ATA_PROGRAM_ID) return " (SPL Associated Token Account)";
  return "";
}

function maybeDecodeTransferChecked(data: Buffer | Uint8Array): string | null {
  if (data.length < 10) return null;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf[0] !== IX_TRANSFER_CHECKED) return null;
  const amount = buf.readBigUInt64LE(1);
  const decimals = buf.readUInt8(9);
  return `TransferChecked { amount=${amount.toString()}, decimals=${decimals} }`;
}

async function main() {
  console.log("─".repeat(72));
  console.log("AHIN — usage-fee transaction rehearsal (BUILD ONLY)");
  console.log("─".repeat(72));
  console.log("RPC URL:           ", RPC_URL);

  const connection = new Connection(RPC_URL, "confirmed");

  // Dummy payer — random keypair, no secret leaves this script. The
  // public key is enough to derive a source ATA.
  const payer = Keypair.generate();
  const treasury = new PublicKey(TREASURY_ADDRESS);
  const feeAmountRaw = 1n;

  console.log("Dummy payer:       ", payer.publicKey.toBase58());
  console.log("Treasury (Squads): ", treasury.toBase58());
  console.log("Fee amount (raw):  ", feeAmountRaw.toString(), "(=", "1e-9 LIFE++", "at 9 decimals)");
  console.log();

  // Try the real RPC path first — that's what production callers do.
  // Fall back to an offline build with a stub blockhash if the live RPC
  // is unreachable (constrained sandboxes, no outbound network, etc.).
  // The fallback mirrors buildUsageFeeTransaction exactly minus the
  // getLatestBlockhash call.
  let tx: Transaction;
  let blockhashSource: "live" | "stub";
  try {
    tx = await buildUsageFeeTransaction({
      connection,
      walletPubkey: payer.publicKey,
      treasuryPubkey: treasury,
      feeAmountRaw
    });
    blockhashSource = "live";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `\n[warn] live RPC unavailable (${msg}). Falling back to offline build with stub blockhash.\n`
    );
    const mint = new PublicKey(LIFE_PLUS_MINT);
    const decimals = await readLifePlusDecimals();
    const sourceAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false);
    const destAta = getAssociatedTokenAddressSync(mint, treasury, true);
    const ix = createTransferCheckedInstruction(
      sourceAta,
      mint,
      destAta,
      payer.publicKey,
      feeAmountRaw,
      decimals
    );
    tx = new Transaction({
      recentBlockhash: STUB_BLOCKHASH,
      feePayer: payer.publicKey
    }).add(ix);
    blockhashSource = "stub";
  }

  console.log("=== Transaction summary ===");
  console.log("blockhash source:  ", blockhashSource);
  console.log("recentBlockhash:   ", tx.recentBlockhash);
  console.log("feePayer:          ", tx.feePayer?.toBase58() ?? "(unset)");
  console.log("instructions count:", tx.instructions.length);

  tx.instructions.forEach((ix, i) => {
    const progId = ix.programId.toBase58();
    console.log();
    console.log(`--- Instruction [${i}] ---`);
    console.log(`  programId:  ${progId}${describeProgramId(progId)}`);
    console.log(`  keys:`);
    ix.keys.forEach((key, j) => {
      const flags: string[] = [];
      if (key.isSigner) flags.push("signer");
      if (key.isWritable) flags.push("writable");
      const flagStr = flags.length ? flags.join(", ") : "readonly";
      console.log(`    [${j}] ${key.pubkey.toBase58()}  (${flagStr})`);
    });
    const dataBuf = Buffer.isBuffer(ix.data) ? ix.data : Buffer.from(ix.data);
    console.log(`  data length: ${dataBuf.length} bytes`);
    console.log(`  data hex:    ${dataBuf.toString("hex")}`);
    const decoded = maybeDecodeTransferChecked(dataBuf);
    if (decoded) console.log(`  decoded:     ${decoded}`);
  });

  console.log();
  console.log("─".repeat(72));
  console.log("Build-only rehearsal complete. No signature requested,");
  console.log("no transaction broadcast.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("\nRehearsal failed:", err);
  process.exitCode = 1;
});
