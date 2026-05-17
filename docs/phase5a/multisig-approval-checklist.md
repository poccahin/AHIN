# Phase 5A Multisig Approval Checklist

## Purpose

This checklist defines approval evidence required before any future Phase 5B asset action. Phase 5A does not collect signatures for live execution.

## Required Approval Roles

```text
technical operator
security reviewer
treasury owner
compliance reviewer
rollback owner
```

No single person may approve all roles.

## Pre-Approval Checklist

```text
[ ] Phase 4 preview verification report reviewed
[ ] wallet allowlist reviewed
[ ] source wallet approved
[ ] destination wallet approved
[ ] micro-transfer cap approved
[ ] burn cap confirmed as zero unless Phase 5B explicitly changes it
[ ] protocol execution flag confirmed disabled
[ ] signing scope documented
[ ] rollback plan approved
[ ] replay attestation template approved
[ ] legal/compliance checklist reviewed
```

## Signing Boundary

Phase 5A approval does not authorize signing. Any future Phase 5B signing event must include:

```text
transaction purpose
asset
amount
source
destination
chain
simulation output
human-readable transaction summary
rollback expectation
attestation plan
explicit operator go/no-go
```

## Blockers

Block Phase 5B if any are true:

```text
unknown signer
unknown wallet owner
private key exposure
transaction data cannot be decoded
amount exceeds cap
destination is not allowlisted
burn instruction is present without separate approval
protocol execution is enabled before audit approval
root ahin.io promotion is bundled into the asset action
```
