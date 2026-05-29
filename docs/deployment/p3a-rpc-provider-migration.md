# P3A RPC Provider Migration Runbook (403 Recovery)

**Phase:** `P3A_RPC_403_PROVIDER_RECOVERY_PREP`
**Audience:** operator, on an authenticated host shell (NOT the sandbox).
**Status this doc prepares for:** the `ahin-io-p3a` worker is deployed
(`https://ahin-io-p3a.doovvvai.workers.dev`, `live-readonly`, `mainnet-beta`),
`SOLANA_RPC_URL` is bound (`rpcSource: "secret_binding"`), but the configured
endpoint returns **`403 Forbidden — Your IP or provider is blocked from this
endpoint`** to the Cloudflare Worker's egress. All on-chain reads fail until the
secret points at a provider that permits Worker egress.

> **No code change can bypass a provider-side IP block.** This is an operator
> infra action (rotate the secret to a compatible provider). The local commit
> `7cebf9e` only improves *diagnostics* and makes off-curve PDA reads work; it
> does not change which provider answers.

Hard boundaries (unchanged): do not deploy root `ahin.io`; do not enable
transfer/burn/signing/canary/public-payment; do not modify the canonical mint
(`7Ydwp…pump`) or treasury (`5Cohfz…CzRo`); do not add env overrides; do not
proceed to P3B.

---

## 1. Required provider capabilities

The replacement RPC must satisfy ALL of:

- **Cloudflare Worker egress allowed** — accepts requests from Cloudflare Worker
  egress IPs (this is the failing requirement today). The public
  `api.mainnet-beta.solana.com` and some free tiers block cloud/Worker IPs.
- **HTTPS JSON-RPC** mainnet-beta endpoint (a single `https://…` URL usable by
  `@solana/web3.js` `new Connection(url)`).
- **`getTokenAccountBalance` / token-account reads** at interactive latency, with
  headroom for the gate's PoCC eligibility checks (high-rate token reads).
- **Stable mainnet-beta access** (uptime/SLA appropriate for a production gate).
- **Server-side secret binding only** — the URL (which may embed an api-key) is
  stored as the `SOLANA_RPC_URL` Worker secret and **never** placed in any
  `NEXT_PUBLIC_*` var or `vars` block (those ship to the browser / git).
- **No browser exposure** — the browser only ever calls
  `/api/solana/lifepp-balance`; it must never receive the RPC URL.

Candidate providers (evaluate against the above — selection is the operator's,
not a marketing pick): **Helius**, **Triton (RPC Pool)**, **QuickNode**. Confirm
each candidate's Worker-egress/allowlist policy and key style before choosing.

---

## 2. Secret rotation plan

`SOLANA_RPC_URL` is a server-only Worker secret on `ahin-io-p3a`. Rotation:

```bash
# On an authenticated host shell, during a stable Cloudflare API window:
npx wrangler whoami                                   # confirm auth
npx wrangler secret put SOLANA_RPC_URL \
  --config wrangler.workers.p3a.jsonc                 # paste the NEW provider URL
npx wrangler secret list --config wrangler.workers.p3a.jsonc   # SOLANA_RPC_URL listed (value hidden)
```

Rules:
- **No code changes** are needed to switch providers — the route resolves the
  secret at request time via `getCloudflareContext().env['SOLANA_RPC_URL']`.
- **No public envs** — never put the keyed URL in `NEXT_PUBLIC_SOLANA_RPC_URL`
  or `wrangler.workers.p3a.jsonc` `vars`.
- **No rebuild required if the deployed code already reads the secret correctly.**
  Worker secrets take effect on the running version without a redeploy. So a
  *secret-only* rotation is sufficient to clear the 403 **if** the currently
  deployed bundle already routes reads through the secret.
- **When a redeploy IS required:**
  - to ship the improved diagnostics / off-curve read fix from commit `7cebf9e`
    (the deployed bundle predates it — currently returns the old empty/raw
    diagnostic for the treasury);
  - if the deployed bundle does not yet resolve the secret via the env binding;
  - after which: `npx opennextjs-cloudflare build --config wrangler.workers.p3a.jsonc`
    then `… deploy --config wrangler.workers.p3a.jsonc` (P3A worker only — never
    root). (`7cebf9e` must be pushed + merged first if deploying from CI.)

---

## 3. Smoke validation sequence (readonly — no tx, no signing, no transfer)

Run the bundled script (Section 3 deliverable) — it asserts each item and exits
non-zero on any failure:

```bash
scripts/p3a-rpc-readonly-smoke.sh \
  https://ahin-io-p3a.doovvvai.workers.dev \
  <KNOWN_ONCURVE_WALLET>
```

What it checks:
1. **Worker health** — `GET /` returns `200`.
2. **Valid wallet read** — `?wallet=<on-curve>` → `ok=true` (`rawBalance`, e.g. `"0"`).
3. **Treasury PDA read** — `?wallet=5Cohfz…` → `ok=true` (now queryable via the
   off-curve read fix) or `"0"`.
4. **Missing wallet** → `400` `missing_wallet_param`.
5. **Invalid wallet** → `400` `invalid_wallet_address`.
6. **`rpcSource` present** (expect `secret_binding`).
7. **No secret leakage** — response contains no `https://` URL and no `api-key`.
8. **No transaction / no signing** — endpoint is GET-only readonly; it never
   builds, signs, submits, or prompts.

A `403` today should surface as `diagnosticCode: "rpc_403_forbidden"` (once
`7cebf9e` is deployed) — a clear, non-empty signal that migration is incomplete.

---

## 4. Rollback plan

Rollback is non-destructive and never arms anything:

- **Revert the secret** to the previous provider URL:
  `npx wrangler secret put SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc`
- **Delete the secret** entirely:
  `npx wrangler secret delete SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc`
- **Fail-soft expectation:** with the secret removed in production
  (`NEXT_PUBLIC_AHIN_ENV=production`), the route returns
  `{ ok:false, error:"rpc_not_configured" }` (HTTP 503) — readonly quote
  unavailable, no crash, no leak. The gate degrades gracefully.
- Invariants during/after rollback: transfer/burn/signing/canary/public-payment
  remain **false**; mint + treasury constants unchanged; root `ahin.io`
  untouched; the separate `ahin-io` and default `wrangler.workers.jsonc`
  (devnet/mock) workers unaffected.

---

## Operator next action (single)

Rotate `SOLANA_RPC_URL` to a Worker-egress-permitting provider (Section 2),
then run `scripts/p3a-rpc-readonly-smoke.sh` (Section 3) and record results in
`reports/ahin-p3a-rpc-provider-migration.template.json` (copy → `.json`).
If the diagnostics fix is needed live, push `7cebf9e` + redeploy `ahin-io-p3a`.
P3B remains blocked regardless.
