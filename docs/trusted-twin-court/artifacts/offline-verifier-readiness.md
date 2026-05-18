# Offline Verifier Readiness Artifact

Source visual reference: `ahin_offline_verifier.html`

The uploaded verifier panel is represented as a local verification readiness prototype. It accepts local certificate text and runs client-side readiness checks for structure and expected readonly fields. It is not wired to WASM, does not call a server, and does not claim cryptographic verification.

## Production-Safe Interpretation

- Offline verifier: prototype
- Network calls: none
- WASM trust kernel: archived, not wired into this browser component
- Verification claim: local readiness checks only
- On-chain submitted: false
- Signing enabled: false

## UI Destination

React component: `src/components/trusted-twin/OfflineVerifierPanel.tsx`

