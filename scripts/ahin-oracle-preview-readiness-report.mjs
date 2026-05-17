import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const wranglerPath = join(root, "wrangler.toml");
const wranglerExamplePath = join(root, "wrangler.toml.example");
const wranglerText = existsSync(wranglerPath) ? readFileSync(wranglerPath, "utf8") : "";
const wranglerExampleText = existsSync(wranglerExamplePath) ? readFileSync(wranglerExamplePath, "utf8") : "";
const configText = wranglerText || wranglerExampleText;

function tomlValue(key, fallback = "") {
  const match = configText.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
  return match?.[1]?.trim() || fallback;
}

const hasOracleBinding = configText.includes('binding = "AHIN_ORACLE_KV"');
const hasPlaceholder = /<REAL_PREVIEW_KV_NAMESPACE_ID>|<PRODUCTION_KV_NAMESPACE_ID>|<PREVIEW_KV_NAMESPACE_ID>/.test(configText);
const kvBindingConfigured = hasOracleBinding && !hasPlaceholder;
const oracleMode = process.env.AHIN_ORACLE_MODE || tomlValue("AHIN_ORACLE_MODE", "readonly");
const protocolExecutionEnabled = (process.env.AHIN_PROTOCOL_EXECUTION_ENABLED || tomlValue("AHIN_PROTOCOL_EXECUTION_ENABLED", "false")) === "true";
const realWalletVerification = (process.env.AHIN_REAL_WALLET_VERIFICATION || tomlValue("AHIN_REAL_WALLET_VERIFICATION", "false")) === "true";
const realLifeBalanceCheck = (process.env.AHIN_REAL_LIFE_BALANCE_CHECK || tomlValue("AHIN_REAL_LIFE_BALANCE_CHECK", "false")) === "true";
const realBurnTransaction = (process.env.AHIN_REAL_BURN_TRANSACTION || tomlValue("AHIN_REAL_BURN_TRANSACTION", "false")) === "true";
const deploymentExecuted = process.env.AHIN_ORACLE_PREVIEW_DEPLOYMENT_EXECUTED === "true";
const previewUrl = process.env.AHIN_ORACLE_PREVIEW_URL || null;
const homepageCheckPassed = process.env.AHIN_ORACLE_HOMEPAGE_CHECK_PASSED === "true";
const oracleReadonlyCheckPassed = process.env.AHIN_ORACLE_READONLY_CHECK_PASSED === "true";
const oracleRejectsMutation = process.env.AHIN_ORACLE_REJECTS_MUTATION === "true";
const rootDomainUntouched = process.env.AHIN_ROOT_DOMAIN_UNTOUCHED ? process.env.AHIN_ROOT_DOMAIN_UNTOUCHED === "true" : true;

const blockers = [];
if (!existsSync(wranglerExamplePath)) {
  blockers.push("wrangler.toml.example is missing.");
}
if (oracleMode !== "readonly") {
  blockers.push("AHIN_ORACLE_MODE must be readonly.");
}
if (!hasOracleBinding) {
  blockers.push("AHIN_ORACLE_KV binding is missing from the preview config.");
}
if (hasPlaceholder) {
  blockers.push("AHIN_ORACLE_KV namespace ID placeholders are still present.");
}
if (protocolExecutionEnabled) {
  blockers.push("AHIN_PROTOCOL_EXECUTION_ENABLED must be false.");
}
if (realWalletVerification) {
  blockers.push("AHIN_REAL_WALLET_VERIFICATION must be false.");
}
if (realLifeBalanceCheck) {
  blockers.push("AHIN_REAL_LIFE_BALANCE_CHECK must be false.");
}
if (realBurnTransaction) {
  blockers.push("AHIN_REAL_BURN_TRANSACTION must be false.");
}

const status = blockers.length
  ? "BLOCKED"
  : deploymentExecuted
    ? homepageCheckPassed && oracleReadonlyCheckPassed && oracleRejectsMutation && rootDomainUntouched
      ? "PASS"
      : "DEPLOYED_VERIFICATION_FAILED"
    : "READY_NOT_DEPLOYED";

const report = {
  project: "ahin.io",
  phase: "Phase 4C",
  report: "Cloudflare KV-bound Readonly Oracle Preview Readiness",
  timestamp: new Date().toISOString(),
  status,
  deploymentExecuted,
  previewUrl,
  oracleMode,
  gitRepoFound: existsSync(join(root, ".git")),
  wranglerConfigExists: existsSync(wranglerPath),
  wranglerExampleExists: existsSync(wranglerExamplePath),
  kvBindingPresent: hasOracleBinding,
  kvBindingConfigured,
  kvBindingPlaceholdersPresent: hasPlaceholder,
  homepageCheckPassed,
  oracleReadonlyCheckPassed,
  oracleRejectsMutation,
  protocolExecutionEnabled,
  realWalletVerification,
  realLifeBalanceCheck,
  realBurnTransaction,
  rootDomainUntouched,
  blockers
};

const reportsDir = join(root, "reports");
mkdirSync(reportsDir, { recursive: true });
writeFileSync(join(reportsDir, "ahin-phase4-oracle-preview-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("Wrote reports/ahin-phase4-oracle-preview-readiness.json");
