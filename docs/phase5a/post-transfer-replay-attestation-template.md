# Phase 5A Post-Transfer Replay Attestation Template

## Purpose

This is a template for a future Phase 5B replay attestation. It must not be filled with live transaction data during Phase 5A because Phase 5A executes no transfer.

## Template

```text
phase:
attestationId:
createdAt:
operator:
reviewers:
commitSha:
workflowRunUrl:
previewUrl:
rootDomainStatus:
```

## Planned Transaction Context

```text
chain:
asset:
sourceWallet:
destinationWallet:
amount:
cap:
transactionIntentHash:
decodedInstructionSummary:
simulationResult:
```

## Replay Inputs

```text
preStateHash:
intentEnvelopeHash:
policyEnvelopeHash:
simulationEnvelopeHash:
approvalEnvelopeHash:
postStateHash:
```

## Safety Assertions

```text
protocolExecutionEnabled=false_before_action
burnInstructionAbsentUnlessExplicitlyApproved=true
transferAmountWithinCap=true
sourceWalletAllowlisted=true
destinationWalletAllowlisted=true
multisigApprovalComplete=true
rootDomainUntouched=true
secretExposure=false
rawPayloadEcho=false
```

## Replay Result

```text
replayStatus:
observedTransactionHash:
observedAmount:
observedSource:
observedDestination:
observedBlockTime:
matchesIntent:
exceptions:
rollbackRequired:
```

## Phase 5A Restriction

In Phase 5A, this template remains empty except for dry-run sample hashes. Do not add real transaction hashes until Phase 5B is explicitly approved.
