# ahin.io Deployment Blocking Standard

## Purpose

This standard prevents pointless release loops while keeping dangerous actions fail-closed. A blocker must protect production integrity, user funds, credentials, domain ownership, or protocol truthfulness. Anything else is a warning, not a reason to stall.

## Hard Blockers

Stop immediately when any of these are true:

1. A command would deploy, modify DNS, modify Cloudflare Pages/Workers/KV, write secrets, or overwrite a public domain without explicit operator confirmation.
2. The target is root `ahin.io` and root overwrite has not been explicitly approved.
3. The current root domain serves an existing site and the requested action could replace it without a staged preview.
4. Required deployment credentials are missing for an external write: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, or equivalent provider credentials.
5. Required Cloudflare project/KV identifiers contain placeholders such as `<PRODUCTION_KV_NAMESPACE_ID>`.
6. `NEXT_PUBLIC_AHIN_GATE_MODE` is not `mock` before real audited wallet adapters, LIFE++ balance checks, and burn transactions exist.
7. `AHIN_PROTOCOL_EXECUTION_ENABLED=true` before protocol execution is implemented, audited, and explicitly approved.
8. The UI claims real wallet verification, real LIFE++ balance checks, real burn, or live protocol execution when the build is mock-only.
9. Build, typecheck, release lint, no-secondary-gate guard, or runtime dependency audit fails for files in this release path.
10. A secret value would be printed, committed, or written to a report.

## Non-Blocking Warnings

Do not stop the release discussion or burn cycles on these alone:

1. Global CLIs are missing when `npx` can run the tool.
2. The workspace is not a git repo during local package preparation, as long as no external deploy is attempted.
3. Root `ahin.io` returns an existing site, if the task is only preparing preview tooling or local build artifacts.
4. Vercel configuration exists while Cloudflare is the chosen path, provided no Vercel deploy is attempted.
5. `dist/` exists alongside `out/`; the active Cloudflare static export target is `out/`.
6. Cloudflare Zero Trust audience tag is missing when the task is UI/package preparation and not edge access enforcement.
7. KV namespaces are missing when the task is documentation, local UI build, or dry-run attestation only.
8. Browser automation is unavailable when equivalent local build, curl, and static output checks prove the requested property.

## Decision Rule

For every requested action, classify it first:

```text
Local read/check/report/documentation: proceed.
Local build/package generation: proceed if tests can run.
Preview deployment: require credentials, target, mock mode, and explicit preview confirmation.
Root production deployment: require preview proof, root overwrite approval, credentials, target, mock mode, and final confirmation.
Protocol/live mode: block until real audited implementation exists.
```

## Token Discipline

Use one concise blocker report when blocked. Do not repeat the same missing prerequisites unless their state changed.

When blocked, output only:

```text
Status
Hard blockers
What is safe to do next
What was not executed
Attestation/report path if updated
```

Do not ask the user to reconfirm facts already proven by commands. Do not keep re-running the same preflight unless a new credential, repo, domain, or config was added.

## Current Release Boundary

Until explicitly changed by an audited implementation phase:

```text
Gate UI + Mock Verification + Agent Matrix Reveal
Mock verification only
No real wallet verification
No real LIFE++ balance check
No real burn transaction
Protocol execution disabled
```
