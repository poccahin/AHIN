export type FiveElementAgentId =
  | "genesis_orange"
  | "rule_purple"
  | "compute_blue"
  | "contract_gold"
  | "eco_green";

export type FiveElementAction =
  | "ASSERT_INTENT"
  | "CREATE_SIGNAL"
  | "OPEN_PROOF_ENVELOPE"
  | "EVALUATE_POLICY"
  | "APPLY_RISK_RULE"
  | "REJECT_UNSAFE_FLOW"
  | "SIMULATE_ROUTE"
  | "READ_ORACLE_QUOTE"
  | "COMPUTE_SCORE"
  | "CREATE_SETTLEMENT_INTENT"
  | "ISSUE_DRY_RUN_CERTIFICATE"
  | "UPDATE_REPUTATION_DRY_RUN"
  | "EMIT_FEEDBACK_EVENT";

export type ProofMode = "mock" | "readonly" | "dry_run";

export interface FiveElementAgentDefinition {
  id: FiveElementAgentId;
  chineseName: string;
  englishName: string;
  role: string;
  allowedActions: readonly FiveElementAction[];
}

export interface AgentFlowStep {
  phase: number;
  agentId: FiveElementAgentId;
  action: FiveElementAction;
}

export interface AgentFlowInput {
  intent: string;
  operatorId?: string;
  context?: Record<string, unknown>;
}

export interface AgentFlowGuards {
  protocolExecutionEnabled?: boolean;
  realWalletTransfer?: boolean;
  realBurnTransaction?: boolean;
}

export interface AgentFlowOptions extends AgentFlowGuards {
  mode?: ProofMode;
  timestamp?: string;
}
