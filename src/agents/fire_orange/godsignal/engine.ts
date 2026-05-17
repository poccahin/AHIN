export interface GodsignalInput {
  operatorId: string;
  signal: string;
  observedAt: string;
}

export interface GodsignalDecision {
  cluster: "fire_orange";
  engine: "godsignal";
  accepted: boolean;
  reason: string;
  traceId: string;
}

export function evaluateGodsignal(input: GodsignalInput): GodsignalDecision {
  const normalizedSignal = input.signal.trim();
  return {
    cluster: "fire_orange",
    engine: "godsignal",
    accepted: normalizedSignal.length > 0,
    reason: normalizedSignal.length > 0 ? "SIGNAL_PRESENT" : "EMPTY_SIGNAL",
    traceId: `${input.operatorId}:${input.observedAt}`
  };
}
