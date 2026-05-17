import assert from "node:assert/strict";
import { FIVE_ELEMENT_FLOW, runFiveElementFlow, runFiveElementSteps } from "../agent-flow-machine";
import { createProofEnvelope, GENESIS_PREVIOUS_HASH } from "../proof-envelope";

const flowInput = {
  intent: "route a readonly LIFE++ collaboration quote",
  operatorId: "agent-test",
  context: { market: "preview", rail: "readonly" }
};

const fixedOptions = {
  timestamp: "2026-05-14T00:00:00.000Z",
  mode: "dry_run" as const
};

function test(name: string, run: () => void) {
  try {
    run();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n`);
    throw error;
  }
}

test("happy path emits deterministic ordered envelopes", () => {
  const result = runFiveElementFlow(flowInput, fixedOptions);
  assert.equal(result.envelopes.length, FIVE_ELEMENT_FLOW.length);
  assert.deepEqual(
    result.envelopes.map((envelope) => envelope.action),
    FIVE_ELEMENT_FLOW.map((step) => step.action)
  );
  assert.equal(result.envelopes[0].previousEnvelopeHash, GENESIS_PREVIOUS_HASH);
  for (let index = 1; index < result.envelopes.length; index += 1) {
    assert.equal(result.envelopes[index].previousEnvelopeHash, result.envelopes[index - 1].envelopeHash);
  }
});

test("illegal action order rejects", () => {
  const invalidSteps = [
    FIVE_ELEMENT_FLOW[1],
    FIVE_ELEMENT_FLOW[0],
    ...FIVE_ELEMENT_FLOW.slice(2)
  ];
  assert.throws(() => runFiveElementSteps(flowInput, invalidSteps, fixedOptions), /Illegal action order/);
});

test("missing previous hash rejects", () => {
  assert.throws(
    () =>
      createProofEnvelope({
        phase: 1,
        agentId: "genesis_orange",
        action: "ASSERT_INTENT",
        input: flowInput,
        output: { ok: true },
        previousEnvelopeHash: "",
        timestamp: fixedOptions.timestamp,
        mode: fixedOptions.mode
      }),
    /previousEnvelopeHash is required/
  );
});

test("realWalletTransfer=true rejects", () => {
  assert.throws(() => runFiveElementFlow(flowInput, { ...fixedOptions, realWalletTransfer: true }), /real wallet transfer/);
});

test("realBurnTransaction=true rejects", () => {
  assert.throws(() => runFiveElementFlow(flowInput, { ...fixedOptions, realBurnTransaction: true }), /real burn transaction/);
});

test("protocolExecutionEnabled=true rejects", () => {
  assert.throws(() => runFiveElementFlow(flowInput, { ...fixedOptions, protocolExecutionEnabled: true }), /protocol execution/);
});

test("output replay produces same root", () => {
  const first = runFiveElementFlow(flowInput, fixedOptions);
  const second = runFiveElementFlow(flowInput, fixedOptions);
  assert.equal(first.rootEnvelopeHash, second.rootEnvelopeHash);
});
