export const TRUSTED_TWIN_CASE_ID = "GOV-2026-0518-EVD";
export const TRUSTED_TWIN_PHASE = "Phase R0-G2 Trusted Twin Court Readiness";
export const G1_PHASE = "G1 · Treasury Funding Readiness Evidence";
export const CANONICAL_TREASURY_MULTISIG = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";
export const CANDIDATE_EVIDENCE_HASH = "0x9f3a4d7b21e6c8a0f4d2b8e1c5a7f0d3b6c9e2a1d4f7b8c0e3a6d5f2b9c1a04";
export const CERTIFICATE_ID = "AHIN-G1-READINESS-20260518-001";
export const ONTOLOGY_INTENT_HASH = "0x5a1b...c913";
export const TWIN_ACTION_HASH = "0x0e42...a8f1";
export const POLICY_HASH = "0x91cd...e275";
export const ROUTE_SIMULATION_HASH = "0x6f2a...0bb4";
export const MERKLE_ROOT = "0x4d75e1b7c84a9e2f019ac34b782cf5d20b6e8a1d7f3c0e49a2b5d6f817c9a03e";

export const TRUSTED_TWIN_FLAGS = {
  onChainSubmitted: false,
  webauthnImplemented: false,
  biometricVerificationClaimed: false,
  multisigStateMutated: false,
  protocolExecutionEnabled: false,
  realWalletTransfer: false,
  realBurnTransaction: false,
  signingEnabled: false,
  transactionSubmissionEnabled: false
} as const;

export const READINESS_EVENTS = [
  { label: "ASSERT_INTENT", actor: "Spark Coral", hash: "0xa3c2...1f84", status: "readiness recorded" },
  { label: "EVALUATE_POLICY", actor: "Codex Purple", hash: "0x8f9a...c021", status: "readonly pass" },
  { label: "SIMULATE_ROUTE", actor: "Currents Blue", hash: "0x4e7a...a4b3", status: "causal replay" },
  { label: "ISSUE_DRY_RUN_CERTIFICATE", actor: "Gold Seal", hash: "0xc1d8...7f4a", status: "pending evidence" },
  { label: "EMIT_FEEDBACK_EVENT", actor: "Eco Green", hash: "0x7b1e...c8d2", status: "draft" }
] as const;

export const CAUSAL_REPLAY_FRAMES = [
  {
    frame: "0001",
    authority: "Spark Coral",
    modelVersion: "pocc-readiness-v1",
    creditDelta: "+0.00",
    cognitiveHash: "0xa3c2...1f84",
    event: "Intent reconstructed in readonly evidence mode"
  },
  {
    frame: "0002",
    authority: "Codex Purple",
    modelVersion: "policy-eval-v1",
    creditDelta: "+0.00",
    cognitiveHash: "0x8f9a...c021",
    event: "Treasury funding remains blocked pending approval evidence"
  },
  {
    frame: "0003",
    authority: "Currents Blue",
    modelVersion: "route-sim-v1",
    creditDelta: "+0.00",
    cognitiveHash: "0x4e7a...a4b3",
    event: "Route simulation reconstructed without ledger state modification"
  }
] as const;

export const CERTIFICATE_PAYLOAD = {
  certificateId: CERTIFICATE_ID,
  caseId: TRUSTED_TWIN_CASE_ID,
  ontologyIntentHash: ONTOLOGY_INTENT_HASH,
  twinActionHash: TWIN_ACTION_HASH,
  policyHash: POLICY_HASH,
  routeSimulationHash: ROUTE_SIMULATION_HASH,
  merkleRoot: MERKLE_ROOT,
  timestamp: "report-timestamp",
  treasuryMultisigAddress: CANONICAL_TREASURY_MULTISIG,
  threshold: "2-of-3",
  onChainSubmitted: false,
  signatureRequestGenerated: false,
  protocolExecutionEnabled: false,
  realWalletTransfer: false,
  realBurnTransaction: false,
  signingEnabled: false
} as const;

export const TRILINGUAL_COPY = {
  zh: {
    label: "中文",
    title: "本体终局意向已确认",
    subtitle: "Readiness Certificate · 候选证据哈希",
    body: "五位责任节点的证据链已形成候选哈希。外部批准证据与独立提交证据归档前，本证书仅表示准备就绪，不产生执行效力。",
    effect: "待外部批准与独立提交证据归档后生效"
  },
  en: {
    label: "English",
    title: "Final human intent confirmed",
    subtitle: "Readiness Certificate · candidate evidence hash",
    body: "The five responsibility nodes have produced a candidate evidence chain. Until external approvals and independent submission evidence are archived, this certificate remains readiness-only.",
    effect: "Effective only after external approvals and independent submission evidence"
  },
  fr: {
    label: "Francais",
    title: "Intention humaine finale confirmee",
    subtitle: "Readiness Certificate · hachage candidat",
    body: "Les cinq noeuds de responsabilite ont produit une chaine de preuves candidate. Avant les approbations externes et les preuves independantes de soumission, ce certificat reste en mode preparation.",
    effect: "Effet uniquement apres approbations externes et preuve independante"
  }
} as const;

export type TrilingualLanguage = keyof typeof TRILINGUAL_COPY;
