# Phase 5A Micro-Transfer Cap Policy

## Purpose

This policy defines maximum future exposure if Phase 5B is explicitly approved. Phase 5A does not execute any transfer.

## Phase 5A Boundary

```text
Current live transfer cap: 0
Current burn cap: 0
Current signing cap: 0
Protocol execution: disabled
```

## Future Phase 5B Cap Requirements

Before any Phase 5B micro-transfer can be considered:

```text
cap amount must be explicitly approved
asset must be explicitly identified
source wallet must be allowlisted
destination wallet must be allowlisted
multisig approval must be complete
rollback plan must be signed off
post-transfer replay attestation template must be ready
legal/compliance checklist must be cleared
```

## Maximum Cap Principles

Any future cap must be:

```text
minimal
single-purpose
time-bound
non-recurring by default
lower than operational loss tolerance
not enough to imply production launch
not enough to bypass compliance review
```

## Suggested Phase 5B Starting Posture

```text
microTransferCapUsd: operator_defined_before_5B
microTransferCapLifePlus: operator_defined_before_5B
burnCap: 0
repeatExecution: false
automaticRetry: false
```

The cap remains zero until Phase 5B is separately approved.
