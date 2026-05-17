# ahin.io Phase 3B Safe Preview Deployment

## Purpose

Deploy the Gate UI safely without overwriting the current `ahin.io` root site. The root domain currently serves an existing `AHIN Cognitive Network` page and must remain untouched until a separate promotion approval is given.

Use `docs/deployment/ahin-blocking-standard.md` to distinguish hard blockers from warnings. Do not stall on non-blocking warnings during preview preparation.

## Recommended Targets

1. Vercel preview URL first
2. `gate.ahin.io` second
3. `ahin.io` root only after explicit Phase 3C promotion approval

## Required Checks Before Deploy

Confirm all of the following before any preview deployment:

```bash
git status --short
test -f .vercel/project.json
npm run lint
npm run typecheck
npm run build
npm run guard:no-agent-gates
npm audit --omit=dev
```

Required public environment:

```text
NEXT_PUBLIC_AHIN_ENV=production
NEXT_PUBLIC_AHIN_TARGET_DOMAIN=gate.ahin.io
NEXT_PUBLIC_AHIN_GATE_MODE=mock
NEXT_PUBLIC_AHIN_DEBUG_MATRIX=false
NEXT_PUBLIC_AHIN_WALLET_MODE=mock
NEXT_PUBLIC_AHIN_REQUIRED_LIFE_USDT=10
NEXT_PUBLIC_AHIN_ENTRY_BURN_AMOUNT=1
```

Do not deploy if `NEXT_PUBLIC_AHIN_GATE_MODE` is anything other than `mock`.

## Safe Preview Deploy

Use a Vercel preview deployment first:

```bash
npx vercel pull --yes --environment=preview --token "$VERCEL_TOKEN"
npx vercel build --token "$VERCEL_TOKEN"
npx vercel deploy --prebuilt --token "$VERCEL_TOKEN"
```

If using `gate.ahin.io`, bind only that subdomain to the preview or production preview project. Do not bind or replace the root `ahin.io` domain during Phase 3B.

## Post-Deploy Checks

Run these against the preview URL or `https://gate.ahin.io`:

```bash
curl -I "$AHIN_PREVIEW_URL"
curl -L "$AHIN_PREVIEW_URL"
```

The page must contain:

```text
ahin.io
Zero-Trust Tunnel
Mock verification mode. On-chain wallet adapters are not enabled in this build.
```

The page must not claim:

```text
real wallet verification
real LIFE++ burn
real on-chain balance verification
protocol execution live
```

## Preview Attestation

Before deployment, this command records the truthful non-deployed state:

```bash
npm run attest:preview
```

After a safe preview deployment:

```bash
AHIN_PREVIEW_DEPLOYMENT_EXECUTED=true \
AHIN_PREVIEW_URL=https://your-vercel-preview-url.example \
AHIN_VERIFY_PREVIEW=true \
npm run attest:preview
```

The report is written to:

```text
reports/ahin-phase3b-preview-deployment-attestation.json
```

## Release Boundary

This is preview deployment only. Protocol execution remains disabled. Do not promote to the root domain without separate Phase 3C approval.
