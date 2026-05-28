export const LIFE_PLUS_MINT = "7YdwpERJjzw7UVojxLpvu5ycKBRdYaxaKn4HvoHLpump";
export const LIFE_PLUS_CHAIN = "solana";
export const LIFE_PLUS_FIXED_SUPPLY = true;
export const LIFE_PLUS_CURRENT_SUPPLY = "993953256.43115";
export const AHIN_AGENT_ADMISSION_USD_THRESHOLD = 10;
export const AHIN_COLLABORATION_USAGE_RULE = "min(1 USDT, 1 LIFE++)";
export const JUPITER_BASE_URL = "https://api.jup.ag";
export const JUPITER_ULTRA_BASE_URL = "https://api.jup.ag/ultra";
// --------------------------------------------------------------------------
// Runtime authorization gates — defense-in-depth.
//
// Architecture: entry/usage fees route as TRANSFER to the canonical
// Squads multisig treasury (Protocol-Owned Liquidity). No burn path —
// deflation is achieved via PoL accumulation, not token destruction.
//
// gateMode "live" only governs which UI to show; it must not authorize
// chain mutations on its own. Operators deliberately arm each level via
// env (wrangler.workers.jsonc vars or `wrangler secret put` for sensitive
// flags). Pre-deploy scripts gate on the same env var names so the two
// layers cannot drift.
// --------------------------------------------------------------------------
// Strictly "live" — NOT "live-readonly". This is the structural guarantee
// that P3A live-readonly mode can never arm transfer: TRANSFER_ENABLED below
// requires isLive, and live-readonly does not satisfy it.
const isLive = process.env.NEXT_PUBLIC_AHIN_GATE_MODE === "live";
const protocolArmed = process.env.AHIN_PROTOCOL_EXECUTION_ENABLED === "true";
const transferArmed = process.env.AHIN_REAL_USAGE_FEE_TRANSFER === "true";

export const PROTOCOL_EXECUTION_ENABLED = isLive && protocolArmed;
export const TRANSFER_ENABLED = isLive && protocolArmed && transferArmed;
