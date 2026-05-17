import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const reportsDir = join(process.cwd(), "reports");
const releaseReportPath = join(reportsDir, "ahin-production-release.json");

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function textEnv(name, fallback) {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function readReleaseReport() {
  try {
    return JSON.parse(readFileSync(releaseReportPath, "utf8"));
  } catch {
    return {};
  }
}

async function verifyProductionUrl(productionUrl) {
  if (!boolEnv("AHIN_VERIFY_PRODUCTION", false)) {
    return {
      homepageCheckPassed: false,
      httpsCheckPassed: false,
      verificationSkipped: true
    };
  }

  try {
    const url = new URL(productionUrl);
    const httpsCheckPassed = url.protocol === "https:";
    const response = await fetch(url, { method: "GET" });
    const body = await response.text();
    return {
      homepageCheckPassed: response.ok && body.includes("ahin.io"),
      httpsCheckPassed: httpsCheckPassed && response.ok,
      verificationSkipped: false
    };
  } catch {
    return {
      homepageCheckPassed: false,
      httpsCheckPassed: false,
      verificationSkipped: false
    };
  }
}

const releaseReport = readReleaseReport();
const productionUrl = textEnv("AHIN_PRODUCTION_URL", releaseReport.siteUrl ?? "https://ahin.io");
const deploymentProvider = textEnv("AHIN_DEPLOYMENT_PROVIDER", "vercel");
const gateMode = textEnv("NEXT_PUBLIC_AHIN_GATE_MODE", textEnv("NEXT_PUBLIC_AHIN_WALLET_MODE", "mock"));
const verification = await verifyProductionUrl(productionUrl);

const report = {
  project: "ahin.io",
  releaseName: "Gate UI + Mock Verification + Agent Matrix Reveal",
  timestamp: new Date().toISOString(),
  gitCommit: gitCommit(),
  deploymentProvider,
  productionUrl,
  deploymentExecuted: boolEnv("AHIN_DEPLOYMENT_EXECUTED", false),
  gateMode,
  realWalletVerification: false,
  realLifeBalanceCheck: false,
  realBurnTransaction: false,
  buildPassed: boolEnv("AHIN_BUILD_PASSED", Boolean(releaseReport.buildPassed)),
  lintPassed: boolEnv("AHIN_LINT_PASSED", Boolean(releaseReport.lintPassed)),
  typecheckPassed: boolEnv("AHIN_TYPECHECK_PASSED", Boolean(releaseReport.typecheckPassed)),
  auditPassed: boolEnv("AHIN_AUDIT_PASSED", false),
  homepageCheckPassed: verification.homepageCheckPassed,
  httpsCheckPassed: verification.httpsCheckPassed,
  verificationSkipped: verification.verificationSkipped,
  productionBoundaryFrozen: true
};

mkdirSync(reportsDir, { recursive: true });
writeFileSync(join(reportsDir, "ahin-production-deployment-attestation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("Wrote reports/ahin-production-deployment-attestation.json");
if (report.verificationSkipped) {
  console.log("Production URL verification skipped. Set AHIN_VERIFY_PRODUCTION=true after deployment to verify https://ahin.io.");
}
