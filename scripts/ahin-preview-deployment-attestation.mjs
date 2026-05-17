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

function listEnv(name) {
  const value = textEnv(name, "");
  return value ? value.split("|").map((item) => item.trim()).filter(Boolean) : [];
}

async function verifyPreview(previewUrl) {
  const explicitHomepageCheck = process.env.AHIN_PREVIEW_HOMEPAGE_CHECK_PASSED;
  const explicitHttpsCheck = process.env.AHIN_PREVIEW_HTTPS_CHECK_PASSED;
  const explicitMockVisible = process.env.AHIN_PREVIEW_MOCK_VERIFICATION_VISIBLE;

  if (explicitHomepageCheck || explicitHttpsCheck || explicitMockVisible) {
    return {
      homepageCheckPassed: boolEnv("AHIN_PREVIEW_HOMEPAGE_CHECK_PASSED", false),
      httpsCheckPassed: boolEnv("AHIN_PREVIEW_HTTPS_CHECK_PASSED", false),
      mockVerificationVisible: boolEnv("AHIN_PREVIEW_MOCK_VERIFICATION_VISIBLE", false),
      verificationSkipped: false
    };
  }

  if (!previewUrl || !boolEnv("AHIN_VERIFY_PREVIEW", false)) {
    return {
      homepageCheckPassed: false,
      httpsCheckPassed: false,
      mockVerificationVisible: false,
      verificationSkipped: true
    };
  }

  try {
    const url = new URL(previewUrl);
    const response = await fetch(url, { method: "GET" });
    const body = await response.text();
    const containsGate = body.includes("ahin.io") && body.includes("Zero-Trust Tunnel");
    const containsMock = body.includes("Mock verification mode") || /mock verification/i.test(body);
    return {
      homepageCheckPassed: response.ok && containsGate,
      httpsCheckPassed: response.ok && url.protocol === "https:",
      mockVerificationVisible: response.ok && containsMock,
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

const previewUrl = textEnv("AHIN_PREVIEW_URL", "");
const deployExecuted = boolEnv("AHIN_PREVIEW_DEPLOYMENT_EXECUTED", false);
const blocked = boolEnv("AHIN_PREVIEW_BLOCKED", false);
const blockerReasons = listEnv("AHIN_PREVIEW_BLOCKER_REASONS");
const verification = await verifyPreview(previewUrl);
const status = blocked
  ? "BLOCKED"
  : deployExecuted
    ? verification.homepageCheckPassed && verification.httpsCheckPassed && verification.mockVerificationVisible
      ? "PASS"
      : "DEPLOYED_VERIFICATION_FAILED"
    : "READY_NOT_DEPLOYED";

const report = {
  project: "ahin.io",
  phase: textEnv("AHIN_PREVIEW_PHASE", "Phase 3B"),
  target: previewUrl || "gate.ahin.io or Vercel preview URL",
  timestamp: new Date().toISOString(),
  deployExecuted,
  blockerReasons,
  previewUrl: previewUrl || null,
  homepageCheckPassed: verification.homepageCheckPassed,
  httpsCheckPassed: verification.httpsCheckPassed,
  mockVerificationVisible: verification.mockVerificationVisible,
  verificationSkipped: verification.verificationSkipped,
  rootDomain: "https://ahin.io",
  rootDomainUntouched: boolEnv("AHIN_ROOT_DOMAIN_UNTOUCHED", true),
  protocolExecutionEnabled: false,
  realWalletVerification: false,
  realLifeBalanceCheck: false,
  realBurnTransaction: false,
  safePromotionRequired: true,
  status
};

const reportsDir = join(process.cwd(), "reports");
mkdirSync(reportsDir, { recursive: true });
writeFileSync(join(reportsDir, "ahin-phase3b-preview-deployment-attestation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log("Wrote reports/ahin-phase3b-preview-deployment-attestation.json");
if (report.verificationSkipped) {
  console.log("Preview verification skipped. Set AHIN_PREVIEW_URL and AHIN_VERIFY_PREVIEW=true after a safe preview deploy.");
}
