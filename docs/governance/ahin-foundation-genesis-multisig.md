# AHIN Foundation Genesis Multisig

## Status

```text
Phase: Phase G0 — AHIN Foundation Genesis Multisig Creation
Network: solana-mainnet
Archive type: governance attestation only
Deployment executed: false
Root ahin.io taken over: false
Protocol execution enabled: false
LIFE++ burn enabled: false
Automated transfer enabled: false
Treasury funding authorized: false
```

## Genesis Multisig Record

```text
Treasury multisig PDA:
6ptousxVRcq84HYuxkaZfrCSVu1HWEzTvYRXNW4t49w6

Governance threshold:
2-of-3

Transaction signature:
3q5PFdQVzKP5GRu8hjpvZL236LqFP993vwdC1jPfd7nZHEnG2UqwDtJ4Poj2XomXMUauS7c1ArnUQwe7D61gQtMK

Solscan:
https://solscan.io/tx/3q5PFdQVzKP5GRu8hjpvZL236LqFP993vwdC1jPfd7nZHEnG2UqwDtJ4Poj2XomXMUauS7c1ArnUQwe7D61gQtMK
```

## Safety Boundary

This archive records the genesis multisig creation evidence only. It does not authorize or implement any operational asset movement.

Explicitly not authorized:

```text
root ahin.io takeover
LIFE++ burn
protocol execution
automated transfer
treasury funding
transaction signing automation
```

## Verification Checklist

Before any later governance phase relies on this multisig, reviewers should confirm:

```text
[ ] Squads UI ownership visible
[ ] signer set reviewed
[ ] threshold reviewed
[ ] transaction finality reviewed
[ ] memo/config-only proposal test recommended
```

## Later Phase Requirements

Any later funding, transfer, burn, signing, or protocol execution phase must require a separate approval path and must not inherit authorization from this archive.
