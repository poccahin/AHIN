# ahin.io Production Deployment Runbook

## Release Boundary

This deployment is **mock verification only**.

It does not verify real wallet balances. It does not burn LIFE++. It does not unlock real agent access. The frozen release surface is:

```text
Gate UI + Mock Verification + Agent Matrix Reveal
```

## Required Vercel Secrets

Configure these in GitHub Actions secrets or the Vercel deployment environment. Do not commit secret values.

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

## Required Production Environment

```text
NEXT_PUBLIC_AHIN_ENV=production
NEXT_PUBLIC_AHIN_TARGET_DOMAIN=ahin.io
NEXT_PUBLIC_AHIN_GATE_MODE=mock
NEXT_PUBLIC_AHIN_DEBUG_MATRIX=false
NEXT_PUBLIC_AHIN_WALLET_MODE=mock
NEXT_PUBLIC_AHIN_REQUIRED_LIFE_USDT=10
NEXT_PUBLIC_AHIN_ENTRY_BURN_AMOUNT=1
```

## Local Release Gate

Run these commands before creating a preview or production deploy:

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm run guard:no-agent-gates
npm audit --omit=dev
```

## Manual Vercel Deploy

Use Vercel only after the required project secrets and production environment variables are configured.

```bash
npx vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
npx vercel build --prod --token "$VERCEL_TOKEN"
npx vercel deploy --prebuilt --prod --token "$VERCEL_TOKEN"
```

## Post-Deploy Verification

```bash
curl -I https://ahin.io
curl https://ahin.io
AHIN_DEPLOYMENT_EXECUTED=true \
AHIN_VERIFY_PRODUCTION=true \
AHIN_DEPLOYMENT_PROVIDER=vercel \
AHIN_PRODUCTION_URL=https://ahin.io \
AHIN_AUDIT_PASSED=true \
npm run attest:deployment
```

The deployment attestation is written to:

```text
reports/ahin-production-deployment-attestation.json
```

Do not mark the deployment as complete unless HTTPS and homepage checks pass.
