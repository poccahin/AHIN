import { createHash } from "node:crypto";
import type { AgentFlowGuards, FiveElementAction, FiveElementAgentId, ProofMode } from "./element-types";

export const GENESIS_PREVIOUS_HASH = "GENESIS";

export interface ProofEnvelope {
  envelopeId: string;
  envelopeHash: string;
  phase: number;
  agentId: FiveElementAgentId;
  action: FiveElementAction;
  inputHash: string;
  outputHash: string;
  previousEnvelopeHash: string;
  timestamp: string;
  mode: ProofMode;
  protocolExecutionEnabled: false;
  realWalletTransfer: false;
  realBurnTransaction: false;
}

export interface CreateProofEnvelopeInput extends AgentFlowGuards {
  phase: number;
  agentId: FiveElementAgentId;
  action: FiveElementAction;
  input: unknown;
  output: unknown;
  previousEnvelopeHash: string;
  timestamp: string;
  mode: ProofMode;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((next, key) => {
        next[key] = canonicalize((value as Record<string, unknown>)[key]);
        return next;
      }, {});
  }
  return value;
}

export function stableStringify(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function assertProofGuards(guards: AgentFlowGuards) {
  if (guards.protocolExecutionEnabled === true) {
    throw new Error("Proof envelope rejected: protocol execution must remain disabled.");
  }
  if (guards.realWalletTransfer === true) {
    throw new Error("Proof envelope rejected: real wallet transfer is not allowed in Phase 4.");
  }
  if (guards.realBurnTransaction === true) {
    throw new Error("Proof envelope rejected: real burn transaction is not allowed in Phase 4.");
  }
}

export function createProofEnvelope(input: CreateProofEnvelopeInput): ProofEnvelope {
  assertProofGuards(input);
  if (!input.previousEnvelopeHash) {
    throw new Error("Proof envelope rejected: previousEnvelopeHash is required.");
  }

  const inputHash = sha256Hex(input.input);
  const outputHash = sha256Hex(input.output);
  const envelopeCore = {
    phase: input.phase,
    agentId: input.agentId,
    action: input.action,
    inputHash,
    outputHash,
    previousEnvelopeHash: input.previousEnvelopeHash,
    timestamp: input.timestamp,
    mode: input.mode,
    protocolExecutionEnabled: false,
    realWalletTransfer: false,
    realBurnTransaction: false
  } as const;
  const envelopeHash = sha256Hex(envelopeCore);

  return {
    envelopeId: `ahin-proof-${envelopeHash.slice(0, 24)}`,
    envelopeHash,
    ...envelopeCore
  };
}
