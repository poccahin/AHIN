# ahin.io Cloudflare Native Deployment Envelope

## Boundary

This package prepares Cloudflare Pages deployment for the Gate UI. It does **not** activate real wallet verification, real LIFE++ balance checks, real burn transactions, or protocol execution.

Before treating any condition as a deployment blocker, use the blocking rules in:

```text
docs/deployment/ahin-blocking-standard.md
```

Keep these values until the on-chain adapters are implemented and audited:

```text
NEXT_PUBLIC_AHIN_GATE_MODE=mock
NEXT_PUBLIC_AHIN_DEBUG_MATRIX=false
AHIN_PROTOCOL_EXECUTION_ENABLED=false
```

Do not set `NEXT_PUBLIC_AHIN_GATE_MODE=live` for this build.

## Deployment Target

The current app is a static Next.js App Router surface. Cloudflare's static Next.js Pages path uses static export and an `out` build directory, so this repository sets:

```text
next.config.mjs: output = "export"
wrangler.toml: pages_build_output_dir = "./out"
```

## Required Cloudflare Environment

```text
CLOUDFLARE_ACCOUNT_ID=<configured outside git>
CLOUDFLARE_API_TOKEN=<configured outside git>
CLOUDFLARE_PAGES_PROJECT_NAME=ahin-io
CLOUDFLARE_ZERO_TRUST_AUDIENCE_TAG=<configured in Cloudflare Zero Trust>
```

Production public values:

```text
NEXT_PUBLIC_AHIN_ENV=production
NEXT_PUBLIC_AHIN_TARGET_DOMAIN=ahin.io
NEXT_PUBLIC_AHIN_GATE_MODE=mock
NEXT_PUBLIC_AHIN_DEBUG_MATRIX=false
NEXT_PUBLIC_AHIN_WALLET_MODE=mock
NEXT_PUBLIC_AHIN_REQUIRED_LIFE_USDT=10
NEXT_PUBLIC_AHIN_ENTRY_BURN_AMOUNT=1
AHIN_PROTOCOL_EXECUTION_ENABLED=false
```

## Local Gate

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm run guard:no-agent-gates
npm audit --omit=dev
```

## Cloudflare Preflight

```bash
npm run preflight:cloudflare
```

The preflight is intentionally strict. It blocks deployment if the directory is not a git repository, `out` is missing, Cloudflare credentials are absent, debug Matrix is enabled, gate mode is not `mock`, or protocol execution is enabled.

## Preview Deploy

```bash
AHIN_CLOUDFLARE_DEPLOY_CONFIRM=DEPLOY_AHIN_PREVIEW \
NEXT_PUBLIC_AHIN_ENV=preview \
NEXT_PUBLIC_AHIN_TARGET_DOMAIN=gate.ahin.io \
NEXT_PUBLIC_AHIN_GATE_MODE=mock \
NEXT_PUBLIC_AHIN_DEBUG_MATRIX=false \
AHIN_PROTOCOL_EXECUTION_ENABLED=false \
npm run deploy:cloudflare:preview
```

## Production Deploy

Only run this after explicit approval to replace the root domain.

```bash
AHIN_CLOUDFLARE_DEPLOY_CONFIRM=DEPLOY_AHIN_IO_ROOT \
NEXT_PUBLIC_AHIN_ENV=production \
NEXT_PUBLIC_AHIN_TARGET_DOMAIN=ahin.io \
NEXT_PUBLIC_AHIN_GATE_MODE=mock \
NEXT_PUBLIC_AHIN_DEBUG_MATRIX=false \
AHIN_PROTOCOL_EXECUTION_ENABLED=false \
npm run deploy:cloudflare:production
```

## Post-Deploy Attestation

```bash
AHIN_CLOUDFLARE_DEPLOYMENT_EXECUTED=true \
AHIN_CLOUDFLARE_DEPLOYMENT_URL=https://gate.ahin.io \
AHIN_CLOUDFLARE_VERIFY_URL=true \
npm run attest:cloudflare
```

The report is written to:

```text
reports/ahin-phase4-cloudflare-deployment-attestation.json
```

## Zero Trust / Worker Note

Cloudflare Access and a Worker-based edge gate can be added after deployment ownership is recovered. For this build, edge blocking must not claim real Web3 enforcement. Use Cloudflare Access policies and `CLOUDFLARE_ZERO_TRUST_AUDIENCE_TAG` only after the identity policy is configured in Cloudflare Zero Trust.
