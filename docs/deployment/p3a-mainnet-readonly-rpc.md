# P3A Mainnet Readonly — Production RPC (server-side secret)

## Purpose

Make the P3A live-readonly mainnet environment use a production-grade Solana
RPC (Helius / Triton / QuickNode / Alchemy) **without exposing the RPC api-key
to the browser**.

The rule that drives this whole design:

> `NEXT_PUBLIC_*` environment variables are inlined into the client JS bundle at
> build time. A paid RPC URL with an embedded api-key placed in
> `NEXT_PUBLIC_SOLANA_RPC_URL` would be shipped to **every visitor**.

So the production RPC lives in a **server-only Worker secret** named
`SOLANA_RPC_URL`, and the browser reads balances through a **server route**
that uses it. The client never sees the URL.

This phase is readonly. It does **not** enable transfer, burn, signing,
canary payment, transaction submission, or treasury mutation, and it does
**not** deploy anything.

## How it works

| Layer | What it does | RPC source |
| --- | --- | --- |
| Browser (`Gatekeeper`) | calls `readLifePlusBalanceRaw()` | none — `fetch('/api/solana/lifepp-balance')` |
| Server route `/api/solana/lifepp-balance` | reads LIFE++ ATA balance, returns `{ rawBalance, decimals }` | `SOLANA_RPC_URL` secret (via `getCloudflareContext().env`) |
| `src/lib/lifePlusSolana.ts` `resolveRpcUrl()` | server fallback resolution | `SOLANA_RPC_URL` → `NEXT_PUBLIC_SOLANA_RPC_URL` → devnet |

- `readLifePlusBalanceRaw` is environment-aware: in the **browser** it routes
  through the server route; on the **server** it reads the chain directly.
- The server route resolves the secret with the same pattern as
  `app/api/verify-turnstile/route.ts`:
  `getCloudflareContext().env["SOLANA_RPC_URL"]` first, then `process.env`
  (local dev), then the public `NEXT_PUBLIC_SOLANA_RPC_URL`, then the devnet
  default.
- The route returns only a coarse `rpcSource` label (`secret_binding` /
  `process_env` / `public_env` / `default_devnet`) — **never the URL itself**.

## Required setup (once, out-of-band)

The paid RPC URL must NOT be committed. Set it as a Worker secret:

```bash
# P3A worker (separate from the root ahin-io worker)
npx wrangler secret put SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc
# Paste the full provider URL when prompted, e.g.:
#   https://mainnet.helius-rpc.com/?api-key=XXXXXXXX
```

Do **not**:

- add `SOLANA_RPC_URL` to the `vars` block of `wrangler.workers.p3a.jsonc`
  (that file is committed to git);
- put the keyed URL in `NEXT_PUBLIC_SOLANA_RPC_URL` (it ships to the browser).

`NEXT_PUBLIC_SOLANA_RPC_URL` stays the public, rate-limited placeholder
(`https://api.mainnet-beta.solana.com`). `NEXT_PUBLIC_SOLANA_CLUSTER` stays
`mainnet-beta` so the readonly UI copy and explorer links are correct.

## Verify the secret is set

```bash
npx wrangler secret list --config wrangler.workers.p3a.jsonc
# Expect SOLANA_RPC_URL to be listed (value is never shown).
```

## Local validation (no deploy)

```bash
npm run lint               # release-lint, incl. the P3A-RPC invariant
npm run typecheck
npm run build              # next build (App Router)
npm run test:payment-canary
npm run test:solana-transfer
npm run test:audit-policy
```

## Deploy (operator action — NOT part of this phase)

Only after the operator explicitly authorizes a P3A run, from an
authenticated host shell:

```bash
# 1. Set the secret (above) if not already set.
# 2. Build + deploy the SEPARATE p3a worker (never the root ahin-io worker):
npx opennextjs-cloudflare build  --config wrangler.workers.p3a.jsonc
npx opennextjs-cloudflare deploy --config wrangler.workers.p3a.jsonc
```

### Post-deploy smoke (readonly)

```bash
# Balance route should resolve via the secret (rpcSource: "secret_binding"):
curl -s "https://<p3a-host>/api/solana/lifepp-balance?wallet=<base58>" | jq .
# Expect: { "ok": true, "rawBalance": "...", "decimals": 9, "rpcSource": "secret_binding" }
# The RPC URL must NOT appear anywhere in the response.

# Dev routes must 404 in production (NEXT_PUBLIC_AHIN_ENV=production):
curl -s -o /dev/null -w "%{http_code}\n" "https://<p3a-host>/api/dev/lifepp-balance?wallet=<base58>"
# Expect: 404
```

Confirm the client bundle does not contain the key:

```bash
# After build, grep the emitted client assets for the provider host / key.
grep -R "helius\|api-key\|triton\|quiknode\|alchemy" .open-next/assets || echo "clean"
```

## Rollback

No deploy happens during this phase, so there is nothing to roll back here.
If a P3A worker is later deployed and must be torn down:

```bash
npx wrangler delete --name ahin-io-p3a   # deletes ONLY the separate P3A worker
```

To rotate or remove the RPC secret:

```bash
npx wrangler secret put    SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc   # rotate
npx wrangler secret delete SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc   # remove
```

This never touches the root `ahin-io` worker or the `ahin.io` domain, and the
default `wrangler.workers.jsonc` remains devnet/mock.

## Boundary

Readonly only. Transfer / burn / signing / canary payment / transaction
submission / treasury mutation remain disabled. P3B (single foundation-wallet
micro-transfer) stays blocked and additionally requires allowlist + cap +
kill-switch drill + OOB mint/treasury/ATA verification + explicit operator
authorization.
