import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function envPresent(name) {
  return Boolean(process.env[name] && process.env[name].trim());
}

function envValue(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

const requiredSecrets = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"];
const requiredPublicEnv = [
  "NEXT_PUBLIC_AHIN_ENV",
  "NEXT_PUBLIC_AHIN_TARGET_DOMAIN",
  "NEXT_PUBLIC_AHIN_GATE_MODE",
  "NEXT_PUBLIC_AHIN_DEBUG_MATRIX"
];

const outDir = join(root, "out");
const wranglerPath = join(root, "wrangler.toml");
const wranglerText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : "";
const checks = {
  gitRepoFound: existsSync(join(root, ".git")),
  wranglerConfigExists: existsSync(wranglerPath),
  outDirExists: existsSync(outDir) && statSync(outDir).isDirectory(),
  kvBindingConfigured: wranglerText.includes('binding = "AGENT_CLUSTER_CACHE"'),
  kvProductionIdConfigured: !wranglerText.includes("<PRODUCTION_KV_NAMESPACE_ID>"),
  kvPreviewIdConfigured: !wranglerText.includes("<PREVIEW_KV_NAMESPACE_ID>"),
  gateMode: envValue("NEXT_PUBLIC_AHIN_GATE_MODE", "mock"),
  debugMatrix: envValue("NEXT_PUBLIC_AHIN_DEBUG_MATRIX", "false"),
  missingSecrets: requiredSecrets.filter((name) => !envPresent(name)),
  missingPublicEnv: requiredPublicEnv.filter((name) => !envPresent(name)),
  protocolExecutionEnabled: envValue("AHIN_PROTOCOL_EXECUTION_ENABLED", "false") === "true"
};

const failures = [];

if (!checks.gitRepoFound) {
  failures.push("Current working directory is not a git repository.");
}
if (!checks.wranglerConfigExists) {
  failures.push("wrangler.toml is missing.");
}
if (!checks.outDirExists) {
  failures.push("Static export directory ./out is missing. Run npm run build first.");
}
if (!checks.kvBindingConfigured) {
  failures.push("AGENT_CLUSTER_CACHE KV binding is missing from wrangler.toml.");
}
if (!checks.kvProductionIdConfigured) {
  failures.push("Production KV namespace ID placeholder is still present in wrangler.toml.");
}
if (!checks.kvPreviewIdConfigured) {
  failures.push("Preview KV namespace ID placeholder is still present in wrangler.toml.");
}
if (checks.gateMode !== "mock") {
  failures.push("NEXT_PUBLIC_AHIN_GATE_MODE must remain mock until real on-chain adapters are implemented.");
}
if (checks.debugMatrix !== "false") {
  failures.push("NEXT_PUBLIC_AHIN_DEBUG_MATRIX must be false for Cloudflare deployment.");
}
if (checks.protocolExecutionEnabled) {
  failures.push("AHIN_PROTOCOL_EXECUTION_ENABLED must remain false for this release.");
}
for (const name of checks.missingSecrets) {
  failures.push(`${name} is missing.`);
}
for (const name of checks.missingPublicEnv) {
  failures.push(`${name} is missing.`);
}

console.log(JSON.stringify({ ...checks, status: failures.length ? "BLOCKED" : "PASS", failures }, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
