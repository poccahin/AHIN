import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

async function verifyUrl(url) {
  if (!url || !boolEnv("AHIN_CLOUDFLARE_VERIFY_URL", false)) {
    return {
      homepageCheckPassed: false,
      httpsCheckPassed: false,
      mockVerificationVisible: false,
      verificationSkipped: true
    };
  }

  try {
    const parsed = new URL(url);
    const response = await fetch(parsed);
    const body = await response.text();
    return {
      homepageCheckPassed: response.ok && body.includes("ahin.io") && body.includes("Zero-Trust Tunnel"),
      httpsCheckPassed: response.ok && parsed.protocol === "https:",
      mockVerificationVisible: response.ok && /mock verification/i.test(body),
      verificationSkipped: false
    };
  } catch {
    return {
      homepageCheckPassed: false,
      httpsCheckPassed: false,
      mockVerificationVisible: false,
      verificationSkipped: false
    };
  }
}

const targetUrl = textEnv("AHIN_CLOUDFLARE_DEPLOYMENT_URL", "");
const deployed = boolEnv("AHIN_CLOUDFLARE_DEPLOYMENT_EXECUTED", false);
const verification = await verifyUrl(targetUrl);
const status = deployed
  ? verification.homepageCheckPassed && verification.httpsCheckPassed && verification.mockVerificationVisible
    ? "PASS"
    : "DEPLOYED_VERIFICATION_FAILED"
  : "READY_NOT_DEPLOYED";

const report = {
  project: "ahin.io",
  phase: "Phase 4",
  release: "Cloudflare Native Deployment Envelope",
  timestamp: new Date().toISOString(),
  deploymentProvider: "cloudflare-pages",
  deploymentExecuted: deployed,
  deploymentUrl: targetUrl || null,
  pagesProjectName: textEnv("CLOUDFLARE_PAGES_PROJECT_NAME", "ahin-io"),
  gateMode: textEnv("NEXT_PUBLIC_AHIN_GATE_MODE", "mock"),
  debugMatrixEnabled: textEnv("NEXT_PUBLIC_AHIN_DEBUG_MATRIX", "false") === "true",
  protocolExecutionEnabled: false,
  realWalletVerification: false,
  realLifeBalanceCheck: false,
  realBurnTransaction: false,
  rootDomainOverwriteApproved: boolEnv("AHIN_ROOT_DOMAIN_OVERWRITE_APPROVED", false),
  homepageCheckPassed: verification.homepageCheckPassed,
  httpsCheckPassed: verification.httpsCheckPassed,
  mockVerificationVisible: verification.mockVerificationVisible,
  verificationSkipped: verification.verificationSkipped,
  status
};

mkdirSync(join(process.cwd(), "reports"), { recursive: true });
writeFileSync(join(process.cwd(), "reports", "ahin-phase4-cloudflare-deployment-attestation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("Wrote reports/ahin-phase4-cloudflare-deployment-attestation.json");
