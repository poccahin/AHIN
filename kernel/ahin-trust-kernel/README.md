# AHIN Trust Kernel

This crate archives the AHIN Trusted Twin Court trust-kernel interface as a readiness artifact.

It is not wired into the production UI, CI deployment workflow, Cloudflare runtime, wallet adapters, or Squads multisig state. The browser console currently labels offline verification as local readiness unless a future reviewed WASM integration is explicitly added.

## Scope

- Merkle root construction.
- Merkle inclusion proof replay.
- Ed25519 signature verification against provided public keys.
- Readiness certificate envelope shape.

## Non-Scope

- No transaction submission.
- No signing helper.
- No WebAuthn/FIDO2 implementation.
- No biometric verification.
- No Squads multisig mutation.
- No protocol execution.

## Canonical Governance Context

- Treasury multisig: `5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo`
- Threshold: 2-of-3
- Current phase: G1 Treasury Funding Readiness Evidence
- Runtime status: readonly evidence mode
- On-chain submitted: false

## Future Integration Gate

Before this crate can be wired into production, AHIN must add:

1. Reviewed WASM build instructions.
2. Browser-side test vectors.
3. External signature evidence format.
4. Negative tests for malformed certificates.
5. Explicit sign-off that the UI may claim cryptographic verification rather than readiness checks.

