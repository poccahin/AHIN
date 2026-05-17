# ahin.io Cloudflare CI Readonly Preview Deploy

## Purpose

Use this path when the local macOS Node/Wrangler native toolchain is blocked. Phase 4C local recovery showed that `workerd` / `esbuild` probes hang locally, and Node 22 isolation also hangs before basic `node` / `npm` checks complete.

This CI path moves the preview deploy into a clean GitHub Actions Linux runner. It is for readonly Cloudflare Pages preview only.

## Boundaries

Do not overwrite root `ahin.io`.

Allowed target:

```text
gate.ahin.io / Cloudflare Pages preview
```

Required release mode:

```text
AHIN_ORACLE_MODE=readonly
AHIN_PROTOCOL_EXECUTION_ENABLED=false
AHIN_REAL_WALLET_VERIFICATION=false
AHIN_REAL_LIFE_BALANCE_CHECK=false
AHIN_REAL_BURN_TRANSACTION=false
NEXT_PUBLIC_AHIN_GATE_MODE=mock
```

This path must not enable LIFE++ transfer, burn, signing, transaction submission, or protocol execution.

## Workflow

Manual workflow:

```text
.github/workflows/ahin-cloudflare-preview.yml
```

It runs only through `workflow_dispatch`.

Inputs:

```text
deployPreview=false
target=preview
```

With `deployPreview=false`, the workflow runs gates only and does not deploy.

With `deployPreview=true`, the deploy job runs only after all gates pass and only when `target=preview`.

## Required GitHub Secrets

Configure these in the GitHub repository or environment used by `cloudflare-preview`:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_PROJECT_NAME
```

Do not commit these values. Do not write them to reports.

## Cloudflare Pages Requirements

The Cloudflare Pages project must be a preview-safe project for the Gate UI, not the root `ahin.io` production site.

Required build output:

```text
out
```

Required KV binding:

```text
AHIN_ORACLE_KV
```

The binding can be configured through the Cloudflare dashboard or `wrangler.toml`. The current `wrangler.toml` contains real `id` and `preview_id` values, with no placeholders.

## CI Gates

The workflow runs:

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm run guard:no-agent-gates
npm audit --omit=dev
npm run test:agents
npm run test:pocc
npm run test:wallet-ux
```

The deploy job re-runs the same gates before deploying.

## Post-Deploy Verification

After a preview deploy, verify the preview URL manually or in a follow-up automation:

```bash
curl -I "$AHIN_PREVIEW_URL"
curl -L "$AHIN_PREVIEW_URL"
curl "$AHIN_PREVIEW_URL/api/oracle/jupiter/lifepp?inputMint=So11111111111111111111111111111111111111112&amount=1000000&slippageBps=50"
```

Expected oracle response properties:

```text
mode=readonly
protocolExecutionEnabled=false
realWalletTransfer=false
realBurnTransaction=false
admissionThresholdUsd=10
collaborationUsageRule=min(1 USDT, 1 LIFE++)
lifePlusMint present
quoteHash present
timestamp present
```

Mutation and invalid request checks:

```text
POST /api/oracle/jupiter/lifepp -> 405
missing params -> 400
invalid amount -> 400
```

## Root Domain Protection

Before and after any preview deploy:

```bash
curl -L https://ahin.io
```

The root domain must continue serving the existing AHIN Cognitive Network surface and must not be replaced by the Gate UI.
