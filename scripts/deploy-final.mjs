import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import fs from "fs";

const creator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('/root/.config/solana/id.json', 'utf-8'))));

// 使用官方负载均衡节点，这在容器内通常最易穿透
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const SQUADS_V3_PROGRAM_ID = new PublicKey("SMPLecDo2uCcUBN9ot9EjaFvXqHTBdtbh6Q7mS7DLP8");

const members = [
    new PublicKey("J8ez8GMsHtd8x4ucd1Q1LuA1k4GJ9dHYFVoa3PpetFDu"), // Lee
    new PublicKey("5ZTByrd1q4FQ7Rfn7XCZCrjArVoaYBwPo7ZzvTrRxx9"), // 石总
    new PublicKey("J7WUW2PgABLq8QswpM9iZ6pFRTJwQmjaqiTWY59zKFe9")  // 杨总
];

async function main() {
    console.log("🚀 [AHIN ENGINE] Initializing core stack...");
    
    const [multisigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("multisig"), creator.publicKey.toBuffer()],
        SQUADS_V3_PROGRAM_ID
    );
    
    console.log("🏛️  Target Foundation Address:", multisigPda.toBase58());

    try {
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        console.log("⚓ Blockhash acquired:", blockhash);

        const ix = multisig.instructions.multisigCreateV2({
            createKey: creator.publicKey,
            creator: creator.publicKey,
            multisigPda,
            configAuthority: creator.publicKey,
            timeLock: 0,
            members: members.map(m => ({ 
                key: m, 
                permissions: { mask: 255 } 
            })),
            threshold: 2,
            programId: SQUADS_V3_PROGRAM_ID
        });

        ix.keys = ix.keys.filter(k => k.pubkey !== undefined);

        const messageV0 = new TransactionMessage({
            payerKey: creator.publicKey,
            recentBlockhash: blockhash,
            instructions: [ix],
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([creator]);

        console.log("📡 Force broadcasting to Solana Mainnet...");
        const signature = await connection.sendTransaction(transaction, {
            skipPreflight: true, // 极其关键：绕过本地 fetch 模拟
            maxRetries: 10
        });
        
        console.log("✅ [SUCCESS] AHIN Foundation is Live!");
        console.log("📜 Explorer: https://solscan.io/tx/" + signature);
        console.log("🚨 MULTISIG_ADDRESS=" + multisigPda.toBase58());
    } catch (e) {
        console.error("❌ Network or Chain Error:", e.message);
    }
}

main().catch(console.error);
