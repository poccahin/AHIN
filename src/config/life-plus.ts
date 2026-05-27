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
// Each switch requires the AND of all relevant flags. gateMode "live" is
// necessary but NOT sufficient on its own (gateMode only governs which UI
// to show; it must not authorize chain mutations by itself). Burn is the
// most destructive so it carries the deepest gate.
//
// Default posture: every flag false ⇒ every export false. Operators must
// deliberately arm each level via env (wrangler.workers.jsonc vars or
// `wrangler secret put` if a flag is treated as sensitive).
//
// Pre-deploy scripts (scripts/deploy_ahin_cloudflare.sh etc.) continue to
// gate on these same env var names — flipping them at the runtime layer
// also makes those pre-deploy gates meaningful in lockstep.
// --------------------------------------------------------------------------
const isLive = process.env.NEXT_PUBLIC_AHIN_GATE_MODE === "live";
const protocolArmed = process.env.AHIN_PROTOCOL_EXECUTION_ENABLED === "true";
const burnArmed = process.env.AHIN_REAL_BURN_TRANSACTION === "true";

export const PROTOCOL_EXECUTION_ENABLED = isLive && protocolArmed;
export const TRANSFER_ENABLED = isLive && protocolArmed;
export const BURN_ENABLED = isLive && protocolArmed && burnArmed;
