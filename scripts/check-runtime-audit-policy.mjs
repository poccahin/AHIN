/**
 * Signed runtime audit policy gate — Phase P2P-B.
 *
 * This is NOT `npm audit || true`. It is a strict exception gate that
 * passes ONLY when every ROOT advisory in the current audit is exactly
 * covered by a signed, unexpired operator accepted-risk pack, AND the
 * runtime safety defaults are intact.
 *
 * MODEL: npm audit flags both real advisories and the entire transitive
 * cascade of packages that "depend on a vulnerable version". Keying the
 * policy on package names is brittle (the cascade set shifts as the tree
 * changes) and was incomplete. Instead we key on ROOT advisory IDs:
 *   - A root advisory is a `via` entry that is an object carrying its own
 *     GHSA source/url (i.e. an actual published advisory).
 *   - A cascade package has only string `via` refs (no own advisory) — it
 *     is accepted by extension once all roots it derives from are accepted.
 * If a genuinely new advisory appears, it introduces a new root GHSA id
 * that is not in the accepted set → the gate FAILS.
 *
 * FAIL (exit 1) if any of:
 *   - accepted-risk pack missing / malformed / unsigned / expired
 *   - operatorApproval.scope missing
 *   - any ROOT advisory id is not in the accepted id set
 *   - a root advisory's severity exceeds the recorded ceiling
 *   - PUBLIC_PAYMENT_ENABLED / BURN_ENABLED not hardcoded false
 *   - AHIN_PAYMENT_CANARY_ENABLED not env-derived (default false)
 *   - AHIN_PAYMENT_CANARY_ALLOWLIST not default-empty
 *   - AHIN_PAYMENT_CANARY_MAX_RAW not default-0n
 *   - audit data unobtainable (fail-safe; never pass blind)
 *
 * Audit data source preference:
 *   1. reports/ci-runtime-audit.json   (CI writes fresh)
 *   2. live `npm audit --omit=dev --json`
 *   3. reports/ahin-p2p-runtime-audit-raw.json (committed snapshot;
 *      registry-down fallback, flagged loudly)
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const ACCEPTED_RISK_PATH = join(root, "reports/ahin-p2p-audit-accepted-risk.json");
const CI_AUDIT_PATH = join(root, "reports/ci-runtime-audit.json");
const SNAPSHOT_AUDIT_PATH = join(root, "reports/ahin-p2p-runtime-audit-raw.json");
const LIFE_PLUS_PAYMENT_PATH = join(root, "src/config/life-plus-payment.ts");

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const note = (m) => notes.push(m);

function extractAdvisoryId(viaObj) {
  const url = typeof viaObj.url === "string" ? viaObj.url : "";
  const m = url.match(/GHSA-[a-z0-9-]+/i);
  if (m) return m[0];
  if (typeof viaObj.source === "string") return viaObj.source;
  if (typeof viaObj.source === "number") return String(viaObj.source);
  return viaObj.name || "unknown-advisory";
}

// ---------------------------------------------------------------------------
// 1. Load + validate the signed accepted-risk pack
// ---------------------------------------------------------------------------
let pack = null;
if (!existsSync(ACCEPTED_RISK_PATH)) {
  fail("Accepted-risk pack missing: reports/ahin-p2p-audit-accepted-risk.json");
} else {
  try {
    pack = JSON.parse(readFileSync(ACCEPTED_RISK_PATH, "utf8"));
  } catch (err) {
    fail(`Accepted-risk pack is malformed JSON: ${err.message}`);
  }
}

const acceptedRootCeiling = new Map(); // GHSA id -> max accepted severity
if (pack) {
  const approval = pack.operatorApproval ?? {};
  if (!approval.signedBy) fail("Accepted-risk pack is unsigned (operatorApproval.signedBy missing).");
  if (!approval.scope) fail("Accepted-risk pack missing operatorApproval.scope.");
  if (!approval.validUntil) {
    fail("Accepted-risk pack missing operatorApproval.validUntil.");
  } else {
    const expiry = Date.parse(approval.validUntil);
    if (Number.isNaN(expiry)) {
      fail(`operatorApproval.validUntil is not a parseable date: ${approval.validUntil}`);
    } else if (expiry < Date.now()) {
      fail(`Accepted-risk approval EXPIRED on ${approval.validUntil}. Re-review required.`);
    } else {
      note(`Approval signed by "${approval.signedBy}", valid until ${approval.validUntil}.`);
    }
  }

  const ceilings = pack.policyEffectIfSigned?.acceptedRootSeverityCeiling;
  const acceptedIds = pack.policyEffectIfSigned?.acceptedAdvisoryIds;
  if (!Array.isArray(acceptedIds) || acceptedIds.length === 0) {
    fail("Accepted-risk pack missing policyEffectIfSigned.acceptedAdvisoryIds.");
  } else if (!ceilings || typeof ceilings !== "object") {
    fail("Accepted-risk pack missing policyEffectIfSigned.acceptedRootSeverityCeiling.");
  } else {
    for (const id of acceptedIds) {
      const sev = ceilings[id];
      if (!sev || !(sev in SEVERITY_RANK)) {
        fail(`Accepted advisory ${id} has no valid severity ceiling.`);
      } else {
        acceptedRootCeiling.set(id, sev);
      }
    }
  }

  // Every documented advisory entry must carry a mitigation field.
  if (Array.isArray(pack.advisories)) {
    for (const adv of pack.advisories) {
      if (adv && adv.id && adv.id.startsWith("GHSA-") && !adv.mitigation) {
        fail(`Accepted root advisory ${adv.id} missing mitigation field.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Acquire current audit data (fail-safe — never pass on missing data)
// ---------------------------------------------------------------------------
function tryParseFile(path) {
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    if (text.includes("503 Service Unavailable") || text.trim().startsWith("npm warn")) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

let audit = tryParseFile(CI_AUDIT_PATH);
let auditSource = audit ? "reports/ci-runtime-audit.json" : null;

if (!audit) {
  try {
    const out = execSync("npm audit --omit=dev --json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    if (!out.includes("503 Service Unavailable")) {
      audit = JSON.parse(out);
      auditSource = "live npm audit";
    }
  } catch (err) {
    const out = (err.stdout && err.stdout.toString()) || "";
    if (out && !out.includes("503 Service Unavailable")) {
      try {
        audit = JSON.parse(out);
        auditSource = "live npm audit";
      } catch {
        /* fall through */
      }
    }
  }
}

if (!audit) {
  audit = tryParseFile(SNAPSHOT_AUDIT_PATH);
  if (audit) {
    auditSource = "committed snapshot (registry unavailable)";
    note(
      "WARNING: live audit unavailable (registry 503). Using committed snapshot " +
        "reports/ahin-p2p-runtime-audit-raw.json. CI should re-run when the registry recovers."
    );
  }
}

if (!audit) {
  fail(
    "Could not obtain audit data from CI file, live npm audit, or committed snapshot. " +
      "Fail-safe: refusing to pass without verifiable audit data."
  );
}

// ---------------------------------------------------------------------------
// 3. Compare ROOT advisories against the accepted set
// ---------------------------------------------------------------------------
const rootAdvisorySeverity = new Map(); // id -> highest observed severity
let cascadeOnlyPackages = 0;
let totalPackages = 0;

if (audit && audit.vulnerabilities && typeof audit.vulnerabilities === "object") {
  for (const [, vuln] of Object.entries(audit.vulnerabilities)) {
    totalPackages += 1;
    const via = Array.isArray(vuln?.via) ? vuln.via : [];
    const ownAdvisories = via.filter((v) => v && typeof v === "object");
    if (ownAdvisories.length === 0) {
      cascadeOnlyPackages += 1;
      continue;
    }
    for (const adv of ownAdvisories) {
      const id = extractAdvisoryId(adv);
      const sev = adv.severity || vuln.severity || "unknown";
      const prev = rootAdvisorySeverity.get(id);
      if (!prev || (SEVERITY_RANK[sev] ?? -1) > (SEVERITY_RANK[prev] ?? -1)) {
        rootAdvisorySeverity.set(id, sev);
      }
    }
  }
}

const acceptedRootsPresent = [];
const unacceptedRoots = [];
for (const [id, sev] of rootAdvisorySeverity) {
  const ceiling = acceptedRootCeiling.get(id);
  if (!ceiling) {
    unacceptedRoots.push(`${id} (${sev})`);
    fail(`Unaccepted ROOT advisory present: ${id} (${sev}). Not in signed accepted-risk pack.`);
    continue;
  }
  if ((SEVERITY_RANK[sev] ?? 99) > (SEVERITY_RANK[ceiling] ?? -1)) {
    fail(`Root advisory ${id} severity ${sev} exceeds accepted ceiling ${ceiling}.`);
  }
  acceptedRootsPresent.push(`${id} (${sev})`);
}

// ---------------------------------------------------------------------------
// 4. Runtime safety defaults (source-level, mirrors release-lint)
// ---------------------------------------------------------------------------
if (!existsSync(LIFE_PLUS_PAYMENT_PATH)) {
  fail("src/config/life-plus-payment.ts is missing.");
} else {
  const src = readFileSync(LIFE_PLUS_PAYMENT_PATH, "utf8");
  if (!/PUBLIC_PAYMENT_ENABLED\s*=\s*false/.test(src) || /PUBLIC_PAYMENT_ENABLED\s*=\s*true/.test(src)) {
    fail("PUBLIC_PAYMENT_ENABLED must be hardcoded false.");
  }
  if (!/BURN_ENABLED\s*=\s*false/.test(src) || /BURN_ENABLED\s*=\s*true/.test(src)) {
    fail("BURN_ENABLED must be hardcoded false.");
  }
  if (!src.includes('process.env.AHIN_PAYMENT_CANARY_ENABLED === "true"')) {
    fail('AHIN_PAYMENT_CANARY_ENABLED must be env-derived (=== "true") so it defaults false.');
  }
  if (!/parseAllowlist[\s\S]*?return\s+\[\]/.test(src)) {
    fail("AHIN_PAYMENT_CANARY_ALLOWLIST must default to an empty array.");
  }
  if (!/parseMaxRaw[\s\S]*?return\s+0n/.test(src)) {
    fail("AHIN_PAYMENT_CANARY_MAX_RAW must default to 0n (which blocks).");
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
console.log("=== Signed Runtime Audit Policy Gate (Phase P2P-B) ===");
console.log(`audit source:          ${auditSource ?? "(none)"}`);
console.log(`packages flagged:      ${totalPackages} (${cascadeOnlyPackages} pure-cascade, no own advisory)`);
console.log(`accepted root advisories: ${acceptedRootsPresent.length ? acceptedRootsPresent.join(", ") : "(none)"}`);
console.log(`unaccepted root advisories: ${unacceptedRoots.length ? unacceptedRoots.join(", ") : "(none)"}`);
for (const n of notes) console.log(`NOTE: ${n}`);
console.log();

if (failures.length === 0) {
  console.log(
    "PASS — every ROOT advisory is documented + operator-signed + within severity ceiling; " +
      "transitive cascade accepted by extension; safety defaults intact."
  );
  process.exit(0);
}

for (const f of failures) console.log(`FAIL: ${f}`);
console.log(`\n${failures.length} policy failure(s). Audit policy gate BLOCKED.`);
process.exit(1);
