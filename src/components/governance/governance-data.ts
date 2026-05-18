export const CANONICAL_TREASURY_MULTISIG = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";
export const TREASURY_MULTISIG_SHORT = "5Coh...CzRo";

export type GovernanceAgentId = "eco" | "spark" | "codex" | "currents" | "seal";
export type GovernanceTone = "coral" | "purple" | "blue" | "amber" | "green";

export interface GovernanceAgent {
  id: GovernanceAgentId;
  index: string;
  glyph: string;
  cnName: string;
  name: string;
  subtitle: string;
  description: string;
  action: string;
  status: "complete" | "running" | "pending";
  statusLabel: string;
  ahinAnchor: string;
  tone: GovernanceTone;
  heartbeat: "OK" | "RUNNING" | "PENDING";
  lastHash: string;
  duration: string;
}

export const GOVERNANCE_AGENTS: GovernanceAgent[] = [
  {
    id: "spark",
    index: "01",
    glyph: "S",
    cnName: "初燃橙",
    name: "Spark Coral",
    subtitle: "Intent assertion",
    description: "Records the governance intent as a dry-run evidence object before any treasury authority can be considered.",
    action: "ASSERT_INTENT",
    status: "complete",
    statusLabel: "complete",
    ahinAnchor: "0xA11F...57C9",
    tone: "coral",
    heartbeat: "OK",
    lastHash: "0xa3c2...1f84",
    duration: "0.08s"
  },
  {
    id: "codex",
    index: "02",
    glyph: "C",
    cnName: "天则紫",
    name: "Codex Purple",
    subtitle: "Policy evaluation",
    description: "Evaluates governance constraints and keeps funding readiness inside evidence collection.",
    action: "EVALUATE_POLICY",
    status: "complete",
    statusLabel: "complete",
    ahinAnchor: "0xD0C4...92B1",
    tone: "purple",
    heartbeat: "OK",
    lastHash: "0x8f9a...c021",
    duration: "0.11s"
  },
  {
    id: "currents",
    index: "03",
    glyph: "R",
    cnName: "算流蓝",
    name: "Currents Blue",
    subtitle: "Readonly route simulation",
    description: "Coordinates readonly protocol state, dry-run routing, and proof continuity without transaction submission.",
    action: "SIMULATE_ROUTE",
    status: "running",
    statusLabel: "running",
    ahinAnchor: "0x0CF1...38EA",
    tone: "blue",
    heartbeat: "RUNNING",
    lastHash: "0x4e7a...a4b3",
    duration: "readonly"
  },
  {
    id: "seal",
    index: "04",
    glyph: "G",
    cnName: "定约金",
    name: "Gold Seal",
    subtitle: "Dry-run certificate",
    description: "Issues custody readiness evidence showing treasury funding remains blocked pending approval evidence.",
    action: "ISSUE_DRY_RUN_CERTIFICATE",
    status: "pending",
    statusLabel: "pending",
    ahinAnchor: "0xC01D...70AF",
    tone: "amber",
    heartbeat: "PENDING",
    lastHash: "0xc1d8...7f4a",
    duration: "not-executed"
  },
  {
    id: "eco",
    index: "05",
    glyph: "E",
    cnName: "灵根绿",
    name: "Eco Green",
    subtitle: "Feedback event",
    description: "Prepares the governance feedback event for later review without activating operational authority.",
    action: "EMIT_FEEDBACK_EVENT",
    status: "pending",
    statusLabel: "pending",
    ahinAnchor: "0xECO5...41DA",
    tone: "green",
    heartbeat: "PENDING",
    lastHash: "0x7b1e...c8d2",
    duration: "not-executed"
  }
];

export const INSPECTOR_AGENT_ORDER: GovernanceAgentId[] = ["eco", "spark", "codex", "currents", "seal"];

export const RESPONSIBILITY_STEPS = [
  { index: "01", action: "ASSERT_INTENT", mode: "dry-run", status: "complete", duration: "0.08s", agentId: "spark" },
  { index: "02", action: "EVALUATE_POLICY", mode: "dry-run", status: "complete", duration: "0.11s", agentId: "codex" },
  { index: "03", action: "SIMULATE_ROUTE", mode: "readonly", status: "running", duration: "readonly", agentId: "currents" },
  { index: "04", action: "ISSUE_DRY_RUN_CERTIFICATE", mode: "dry-run", status: "pending", duration: "not executed", agentId: "seal" },
  { index: "05", action: "EMIT_FEEDBACK_EVENT", mode: "dry-run", status: "pending", duration: "not executed", agentId: "eco" }
] as const;

export const TREASURY_RAW_STATE = {
  treasuryMultisigAddress: CANONICAL_TREASURY_MULTISIG,
  threshold: "2-of-3",
  members: 3,
  phase: "G1_EVIDENCE_COLLECTION",
  treasuryFundingEnabled: false,
  protocolExecutionEnabled: false,
  lifePlusTransferEnabled: false,
  burnEnabled: false,
  signingEnabled: false,
  transactionSubmissionEnabled: false
} as const;

export const COGNITIVE_HASH_STREAM = [
  {
    timestamp: "report-time",
    authority: "Spark Coral",
    event: "readonly evidence mode",
    hash: "0xa3c2...1f84",
    status: "candidate hash"
  },
  {
    timestamp: "report-time",
    authority: "Codex Purple",
    event: "policy evaluated",
    hash: "0x8f9a...c021",
    status: "no signature request generated"
  },
  {
    timestamp: "report-time",
    authority: "Currents Blue",
    event: "route reconstructed",
    hash: "0x4e7a...a4b3",
    status: "no chain execution"
  },
  {
    timestamp: "report-time",
    authority: "Gold Seal",
    event: "readiness certificate queued",
    hash: "0xc1d8...7f4a",
    status: "pending external approval evidence"
  },
  {
    timestamp: "report-time",
    authority: "Eco Green",
    event: "feedback event prepared",
    hash: "0x7b1e...c8d2",
    status: "no ledger state modified"
  }
] as const;

export function getGovernanceAgent(id: GovernanceAgentId) {
  return GOVERNANCE_AGENTS.find((agent) => agent.id === id) ?? GOVERNANCE_AGENTS[2];
}
