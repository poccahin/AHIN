console.log("⚡ [PROBE] Native Node.js environment booted instantly...");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const multisig = require("@sqds/multisig");
const fs = require("fs");

const connection = new Connection("https://mainnet.rpc.jpool.one", "confirmed");

const secretKeyString = fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8");
const creatorKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKeyString)));

const member1 = new PublicKey("J8ez8GMsHtd8x4ucd1Q1LuA1k4GJ9dHYFVoa3PpetFDu"); 
const member2 = new PublicKey("5ZTByrd1q4FQ7Rfn7XCZCrjArVoaYBwPo7ZzvTrRxx9"); 
const member3 = new PublicKey("J7WUW2PgABLq8QswpM9iZ6pFRTJwQmjaqiTWY59zKFe9"); 

async function constructMultisig() {
    console.log("🚀 [Phase 5B] Initiating Foundation Multisig Construction...");
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

constructMultisig().catch(err => {
    console.error("\n❌ Deployment Failed:");
    console.error(err.message || err);
});
