import type {
  AgentFlowInput,
  AgentFlowOptions,
  AgentFlowStep,
  FiveElementAction,
  FiveElementAgentDefinition,
  FiveElementAgentId,
  ProofMode
} from "./element-types";
import { contractGoldAgent } from "./contract-gold";
import { computeBlueAgent } from "./compute-blue";
import { ecoGreenAgent } from "./eco-green";
import { genesisOrangeAgent } from "./genesis-orange";
import { GENESIS_PREVIOUS_HASH, assertProofGuards, createProofEnvelope, type ProofEnvelope } from "./proof-envelope";
import { rulePurpleAgent } from "./rule-purple";

export const FIVE_ELEMENT_AGENTS: Record<FiveElementAgentId, FiveElementAgentDefinition> = {
  genesis_orange: genesisOrangeAgent,
  rule_purple: rulePurpleAgent,
  compute_blue: computeBlueAgent,
  contract_gold: contractGoldAgent,
  eco_green: ecoGreenAgent
};

export const FIVE_ELEMENT_FLOW: readonly AgentFlowStep[] = [
  { phase: 1, agentId: "genesis_orange", action: "ASSERT_INTENT" },
  { phase: 2, agentId: "rule_purple", action: "EVALUATE_POLICY" },
  { phase: 3, agentId: "compute_blue", action: "SIMULATE_ROUTE" },
  { phase: 4, agentId: "contract_gold", action: "CREATE_SETTLEMENT_INTENT" },
  { phase: 5, agentId: "contract_gold", action: "ISSUE_DRY_RUN_CERTIFICATE" },
  { phase: 6, agentId: "eco_green", action: "EMIT_FEEDBACK_EVENT" }
];

export interface AgentFlowResult {
  envelopes: ProofEnvelope[];
  rootEnvelopeHash: string;
  mode: ProofMode;
  protocolExecutionEnabled: false;
  realWalletTransfer: false;
  realBurnTransaction: false;
}

function assertKnownAction(agentId: FiveElementAgentId, action: FiveElementAction) {
  const agent = FIVE_ELEMENT_AGENTS[agentId];
  if (!agent.allowedActions.includes(action)) {
    throw new Error(`Illegal action ${action} for ${agent.englishName}.`);
  }
}

function assertExpectedStep(step: AgentFlowStep, expected: AgentFlowStep) {
  if (step.phase !== expected.phase || step.agentId !== expected.agentId || step.action !== expected.action) {
    throw new Error(`Illegal action order at phase ${expected.phase}. Expected ${expected.action}.`);
  }
}

function buildStepOutput(input: AgentFlowInput, step: AgentFlowStep, previousEnvelopeHash: string) {
  const base = {
    intent: input.intent,
    operatorId: input.operatorId ?? "anonymous",
    previousEnvelopeHash
  };

  switch (step.action) {
    case "ASSERT_INTENT":
      return { ...base, signalOpened: true, flowState: "intent_asserted" };
    case "EVALUATE_POLICY":
      return { ...base, riskScore: 0, policyDecision: "allow_dry_run" };
    case "SIMULATE_ROUTE":
      return { ...base, routeMode: "readonly_oracle_simulation", estimatedScore: 1 };
    case "CREATE_SETTLEMENT_INTENT":
      return { ...base, settlementIntent: "dry_run_only", escrowIntentCreated: false };
    case "ISSUE_DRY_RUN_CERTIFICATE":
      return { ...base, certificate: "dry_run_settlement_certificate", executable: false };
    case "EMIT_FEEDBACK_EVENT":
      return { ...base, reputationDelta: 0, feedbackEvent: "phase4_flow_recorded" };
    default:
      return base;
  }
}

export function runFiveElementSteps(
  flowInput: AgentFlowInput,
  steps: readonly AgentFlowStep[],
  options: AgentFlowOptions = {}
): AgentFlowResult {
  assertProofGuards(options);
  if (!flowInput.intent.trim()) {
    throw new Error("Five-element flow requires a non-empty intent.");
  }

  const timestamp = options.timestamp ?? new Date().toISOString();
  const mode = options.mode ?? "dry_run";
  let previousEnvelopeHash = GENESIS_PREVIOUS_HASH;
  const envelopes = steps.map((step, index) => {
    const expected = FIVE_ELEMENT_FLOW[index];
    if (!expected) {
      throw new Error(`Unexpected phase ${step.phase}.`);
    }
    assertExpectedStep(step, expected);
    assertKnownAction(step.agentId, step.action);

    const output = buildStepOutput(flowInput, step, previousEnvelopeHash);
    const envelope = createProofEnvelope({
      phase: step.phase,
      agentId: step.agentId,
      action: step.action,
      input: { flowInput, previousEnvelopeHash },
      output,
      previousEnvelopeHash,
      timestamp,
      mode
    });
    previousEnvelopeHash = envelope.envelopeHash;
    return envelope;
  });

  if (envelopes.length !== FIVE_ELEMENT_FLOW.length) {
    throw new Error("Five-element flow did not complete all required phases.");
  }

  return {
    envelopes,
    rootEnvelopeHash: previousEnvelopeHash,
    mode,
    protocolExecutionEnabled: false,
    realWalletTransfer: false,
    realBurnTransaction: false
  };
}

export function runFiveElementFlow(flowInput: AgentFlowInput, options: AgentFlowOptions = {}) {
  return runFiveElementSteps(flowInput, FIVE_ELEMENT_FLOW, options);
}
