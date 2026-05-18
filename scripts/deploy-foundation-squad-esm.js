console.log("⚡ [PROBE 1] Booting Native Node.js ESM Engine...");
import fs from "fs";
console.log("⚡ [PROBE 2] File System loaded.");

async function main() {
    console.log("⚡ [PROBE 3] Dynamically importing Solana web3.js...");
    const { Connection, Keypair, PublicKey } = await import("@solana/web3.js");

    console.log("⚡ [PROBE 4] Dynamically importing Squads SDK (This might take a few seconds)...");
    const multisig = await import("@sqds/multisig");

    console.log("🚀 [Phase 5B] All dependencies loaded! Initiating Construction...");

    const connection = new Connection("https://mainnet.rpc.jpool.one", "confirmed");
    const secretKeyString = fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8");
    const creatorKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyString)));

    const member1 = new PublicKey("J8ez8GMsHtd8x4ucd1Q1LuA1k4GJ9dHYFVoa3PpetFDu");
    const member2 = new PublicKey("5ZTByrd1q4FQ7Rfn7XCZCrjArVoaYBwPo7ZzvTrRxx9");
    const member3 = new PublicKey("J7WUW2PgABLq8QswpM9iZ6pFRTJwQmjaqiTWY59zKFe9");

    console.log(`🔑 Creator (Gas Payer): ${creatorKeypair.publicKey.toBase58()}`);

    const balance = await connection.getBalance(creatorKeypair.publicKey);
    console.log(`💰 Creator Balance: ${balance / 1e9} SOL`);
    if (balance < 0.005 * 1e9) throw new Error("❌ Insufficient SOL.");

    const createKey = Keypair.generate();
    const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });

    console.log(`\n⏳ Calculating Vault PDA...`);
    console.log(`🏛️ Target Foundation Address: ${multisigPda.toBase58()}`);
    console.log(`🔗 Initiating On-Chain Deployment...`);

    const signature = await multisig.rpc.multisigCreateV2({
        connection,
        createKey,
        creator: creatorKeypair,
        multisigPda,
        configAuthority: null,
        timeLock: 0,
        members: [
            { key: member1, permissions: multisig.types.Permissions.all() },
            { key: member2, permissions: multisig.types.Permissions.all() },
            { key: member3, permissions: multisig.types.Permissions.all() },
        ],
        threshold: 2,
        sendOptions: { skipPreflight: true },
    });

    console.log(`\n✅ [SUCCESS] Foundation Multisig deployed to Mainnet!`);
    console.log(`🔗 Transaction Signature: https://solscan.io/tx/${signature}`);
    console.log(`\n🚨 IMPORTANT: Add this Vault Address to your .env.production:`);
    console.log(`NEXT_PUBLIC_AHIN_FOUNDATION_MULTISIG=${multisigPda.toBase58()}`);
}

main().catch(console.error);
