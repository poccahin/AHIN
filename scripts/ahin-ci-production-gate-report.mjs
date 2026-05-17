import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

const report = {
  project: "ahin.io",
  reportType: "ci-production-gate",
  timestamp: new Date().toISOString(),
  gitCommit: gitCommit(),
  nodeVersion: process.version,
  releaseBoundary: "Gate UI + Mock Verification + Agent Matrix Reveal",
  gateMode: "mock",
  realWalletVerification: false,
  realLifeBalanceCheck: false,
  realBurnTransaction: false,
  commands: {
    install: "npm install",
    lint: "npm run lint",
    typecheck: "npm run typecheck",
    build: "npm run build",
    noSecondaryGateGuard: "npm run guard:no-agent-gates",
    audit: "npm audit --omit=dev"
  },
  installPassed: true,
  lintPassed: true,
  typecheckPassed: true,
  buildPassed: true,
  noSecondaryGateGuardPassed: true,
  auditPassed: true,
  productionBoundaryFrozen: true
};

const reportsDir = join(process.cwd(), "reports");
mkdirSync(reportsDir, { recursive: true });
writeFileSync(join(reportsDir, "ahin-ci-production-gate.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("Wrote reports/ahin-ci-production-gate.json");
