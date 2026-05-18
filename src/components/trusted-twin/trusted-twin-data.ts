export const TRUSTED_TWIN_CASE_ID = "GOV-2026-0518-EVD";
export const TRUSTED_TWIN_PHASE = "Phase R0-G2 Trusted Twin Court Readiness";
export const G1_PHASE = "G1 · Treasury Funding Readiness Evidence";
export const CANONICAL_TREASURY_MULTISIG = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";
export const CANDIDATE_EVIDENCE_HASH = "0x9f3a4d7b21e6c8a0f4d2b8e1c5a7f0d3b6c9e2a1d4f7b8c0e3a6d5f2b9c1a04";

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

export const TRILINGUAL_COPY = {
  zh: {
    label: "中文",
    title: "本体终局意向已确认",
    subtitle: "Readiness Certificate · 候选证据哈希",
    body: "五位责任节点的证据链已形成候选哈希。外部签名与链上提交完成前，本证书仅表示准备就绪，不产生执行效力。",
    effect: "待外部签名与链上提交后生效"
  },
  en: {
    label: "English",
    title: "Final human intent confirmed",
    subtitle: "Readiness Certificate · candidate evidence hash",
    body: "The five responsibility nodes have produced a candidate evidence chain. Until external approvals and chain submission are evidenced, this certificate remains readiness-only.",
    effect: "Effective only after external signatures and chain submission"
  },
  fr: {
    label: "Francais",
    title: "Intention humaine finale confirmee",
    subtitle: "Readiness Certificate · hachage candidat",
    body: "Les cinq noeuds de responsabilite ont produit une chaine de preuves candidate. Avant les approbations externes et la soumission sur registre, ce certificat reste en mode preparation.",
    effect: "Effet uniquement apres signatures externes et soumission sur registre"
  }
} as const;

export type TrilingualLanguage = keyof typeof TRILINGUAL_COPY;

