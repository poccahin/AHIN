# Phase 5A Wallet Allowlist Policy

## Purpose

This policy defines how wallets would be considered for a future Phase 5B dry-run or micro-transfer review. It does not approve or connect any wallet in Phase 5A.

## Boundary

```text
Live wallet transfer: false
Real burn: false
Signing: false
Protocol execution: false
Root takeover: false
```

## Allowlist Categories

Candidate wallets must be classified before any future Phase 5B action:

```text
operator_controlled
multisig_controlled
treasury_observer
test_observer
revoked_or_blocked
```

Only `operator_controlled` or `multisig_controlled` wallets may be proposed for a future Phase 5B review.

## Required Wallet Record

Each candidate record must include:

```text
walletAddress
chain
custodyModel
ownerLabel
approvalSource
riskNotes
allowlistStatus
createdAt
reviewedAt
reviewer
```

Do not include private keys, seed phrases, API keys, or wallet secrets.

## Screening Requirements

Before a wallet can move from candidate to approved:

```text
address format verified
chain verified
owner or multisig authority verified
sanctions / blocked entity screen completed
no private key exposure
no browser extension signing dependency for unattended operations
rollback contact identified
```

## Revocation

Any of these conditions revoke a wallet:

```text
unknown ownership
lost custody
private key or seed exposure
unexpected transaction activity
blocked entity risk
operator withdrawal
multisig signer dispute
```

Revoked wallets must not be used in Phase 5B.
