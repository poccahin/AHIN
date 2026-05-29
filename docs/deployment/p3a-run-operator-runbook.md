# P3A-Run — Operator-Side Runbook (Mainnet Readonly Live-UI)

**Audience:** the operator, running on an **authenticated host shell** (NOT the
sandbox). Every command below is executed by the operator. The sandbox/agent
does not run any of these.

**What P3A-Run does:** deploys the **separate** `ahin-io-p3a` Worker in
`live-readonly` mode against `mainnet-beta`, so the live wallet UI reads **real**
LIFE++ balances + evaluates PoCC eligibility through a **server-side** RPC. It is
**structurally incapable of transfer**: `src/config/life-plus.ts` keys `isLive`
on exactly `"live"`, and this deploy is `"live-readonly"`.

**What P3A-Run must never do:** touch root `ahin.io` / the `ahin-io` worker;
enable transfer, burn, signing, canary payment, or public payment; request a
signature; submit a transaction; mutate treasury/Squads state; expose the paid
RPC key to the browser.

**Verified pre-state (as of this runbook):**
- Remote `main`: `94b1f6134dc4b705880b67389211503ca23a721e`
- Production gate: **PASS** (run `26619658690`)
- Gates-only preview: **PASS**, deploy job **skipped** (latest run `26622711158`)
- Verdict: `P3A_RPC_CI_PASS_NOT_DEPLOYED`

---

## 0. CORRECTED STATE (2026-05-29) — P3A worker is ALREADY DEPLOYED

> Supersedes the "deploy" framing below for the current cycle. Established from
> `~/Library/Preferences/.wrangler/logs` + a live probe.

- **The P3A worker is already live:** `https://ahin-io-p3a.doovvvai.workers.dev`
  (worker `ahin-io-p3a`, Version `8cde4a3c-0e5a-48ec-83e3-ea354f23d08e`,
  deployed from the host at **2026-05-29T07:56:44Z**; live-probe returned `HTTP 200`).
- **Mode `live-readonly` on `mainnet-beta`** — transfer is structurally
  impossible; all transfer/canary/burn/signing/public-payment flags are false.
- **`SOLANA_RPC_URL` secret is NOT set** (the 07:52 `secret put` attempt failed
  on intermittent connectivity; no `Secret` binding in the successful deploy).
  So the balance route currently returns the intended **fail-soft**
  `rpc_not_configured` (readonly reads unavailable) — no leak, no crash.
- **Root `ahin.io` untouched** — the deploy was the separate `ahin-io-p3a`
  worker; the root `ahin-io` worker was last deployed 2026-05-23.

**The next action is NOT a deploy.** Section 5 (build + deploy) can be SKIPPED
for this cycle. The next action is **setting the `SOLANA_RPC_URL` secret during a
stable Cloudflare API window**, then running smoke tests only.

Still forbidden, same as ever: do not bind root `ahin.io`; do not enable
transfer flags; do not enable canary; do not enable burn; do not enable signing.

### 0a. Host-side next commands

```bash
cd /Users/lee/Developer/ahin.io

# Confirm auth (the 07:56 deploy proves the OAuth token is valid; if this
# returns "fetch failed", it's intermittent connectivity — retry, do not
# assume logged out).
npx wrangler whoami

# Set the production RPC as a server-only secret (never NEXT_PUBLIC, never
# committed). Retry if it hits a transient fetch failure.
npx wrangler secret put SOLANA_RPC_URL \
  --config wrangler.workers.p3a.jsonc
```

> Setting the secret takes effect on the already-deployed worker without a
> redeploy. If you prefer, a redeploy after the secret is set is also fine, but
> not required for the secret to bind.

### 0b. Smoke tests (after the secret is set) — readonly only

```bash
# Worker root is up.
curl -I https://ahin-io-p3a.doovvvai.workers.dev

# Balance route for a known holder (server-side RPC via the secret).
curl -s "https://ahin-io-p3a.doovvvai.workers.dev/api/solana/lifepp-balance?wallet=<KNOWN_SOLANA_WALLET>" | jq

# Missing wallet -> 400.
curl -i "https://ahin-io-p3a.doovvvai.workers.dev/api/solana/lifepp-balance"

# Invalid wallet -> 400.
curl -i "https://ahin-io-p3a.doovvvai.workers.dev/api/solana/lifepp-balance?wallet=bad"
```

**Required smoke expectations:**
- P3A URL returns **200**.
- Balance route returns `ok=true` (known holder) **or** a clean readonly error
  (e.g. `rpc_not_configured` if the secret didn't bind) — never a 500/stack.
- Response **does not contain the RPC URL** / api-key / provider host.
- Missing wallet → **400**; invalid wallet → **400**.
- **No signature prompt · no transaction submitted · no transfer.**
- Root `ahin.io` **unchanged**.

### 0c. Cloudflare connectivity note

- Host logs show the **deploy succeeded** (CF API `200`s) at 07:56:44Z.
- The `fetch failed` lines after a successful deploy are typically the
  **Metrics dispatcher** (Amplitude telemetry) — post-deploy noise, not failure.
- Cloudflare API connectivity here is **intermittent, not permanently blocked**
  (07:44–07:53 failed, 07:56 succeeded). **Retry** during a stable window.
- A `dash.cloudflare.com` `cf-mitigated: challenge` (403) is a browser/IP
  challenge and does **not** block OAuth/API-token CLI calls once the network
  path is stable.
- Optional robustness: the **API token path**
  (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` exported locally, never
  committed/pasted) avoids the OAuth refresh round-trip. Not required — OAuth
  is functional.

---

## 1. Preflight checks

```bash
cd /path/to/ahin.io   # operator's checkout

# 1a. Repo is clean (a dirty tsconfig.tsbuildinfo build artifact is acceptable;
#     anything else: investigate before proceeding).
git status --short

# 1b. Remote main is the verified SHA.
git fetch origin
git rev-parse origin/main
# EXPECT: 94b1f6134dc4b705880b67389211503ca23a721e

# 1c. Latest production gate AND gates-only preview are green for that SHA.
gh run list --repo poccahin/AHIN --limit 10 \
  --json databaseId,headSha,workflowName,event,status,conclusion,createdAt \
  | jq -r '.[] | select(.headSha=="94b1f6134dc4b705880b67389211503ca23a721e")
           | "\(.databaseId) | \(.workflowName) | \(.event) | \(.status)/\(.conclusion)"'
# EXPECT: "ahin production gate / push / completed/success"
#         "ahin Cloudflare readonly preview / workflow_dispatch / completed/success"

# 1d. P3A config targets a SEPARATE worker, not root ahin.io.
grep -E '"name"|TARGET_DOMAIN' wrangler.workers.p3a.jsonc
# EXPECT: "name": "ahin-io-p3a"      (NOT "ahin-io")
#         NEXT_PUBLIC_AHIN_TARGET_DOMAIN = "p3a.ahin.io"  (NOT "ahin.io")

# 1e. live-readonly mode + mainnet-beta.
grep -E 'GATE_MODE|SOLANA_CLUSTER|AHIN_ENV' wrangler.workers.p3a.jsonc
# EXPECT: NEXT_PUBLIC_AHIN_GATE_MODE = "live-readonly"
#         NEXT_PUBLIC_SOLANA_CLUSTER = "mainnet-beta"
#         NEXT_PUBLIC_AHIN_ENV       = "production"

# 1f. All transfer / canary / burn flags false (and canary keys absent).
grep -E 'PROTOCOL_EXECUTION_ENABLED|REAL_WALLET_VERIFICATION|REAL_LIFE_BALANCE_CHECK|REAL_USAGE_FEE_TRANSFER|CANARY' wrangler.workers.p3a.jsonc
# EXPECT: AHIN_PROTOCOL_EXECUTION_ENABLED = "false"
#         AHIN_REAL_WALLET_VERIFICATION   = "false"
#         AHIN_REAL_LIFE_BALANCE_CHECK    = "false"
#         AHIN_REAL_USAGE_FEE_TRANSFER    = "false"
#         AHIN_PAYMENT_CANARY_* : not present (defaults: disabled / empty / 0n)

# 1g. Structural transfer-incapability (source-level guarantee).
grep -n 'const isLive' src/config/life-plus.ts
# EXPECT: const isLive = process.env.NEXT_PUBLIC_AHIN_GATE_MODE === "live";
#         (live-readonly !== "live" => TRANSFER_ENABLED can never be true)
```

**STOP** if any expectation fails. Do not proceed.

---

## 2. Cloudflare auth

```bash
npx wrangler whoami
# Must print the authenticated account/email.

# If NOT authenticated:
npx wrangler login
# Complete the browser OAuth, then re-run `npx wrangler whoami` to confirm.
```

---

## 3. Set the server-side RPC secret

The production RPC (Helius / Triton / QuickNode / Alchemy) is a **server-only
Worker secret**. It is never inlined into client JS and never committed.

```bash
npx wrangler secret put SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc
# Paste the full provider URL when prompted, e.g.:
#   https://mainnet.helius-rpc.com/?api-key=XXXXXXXX

# Verify it is registered (value is never shown):
npx wrangler secret list --config wrangler.workers.p3a.jsonc
# EXPECT: SOLANA_RPC_URL listed.
```

**Do NOT:**
- put the keyed URL in `NEXT_PUBLIC_SOLANA_RPC_URL` (it ships to the browser);
- add `SOLANA_RPC_URL` to the `vars` block of `wrangler.workers.p3a.jsonc`;
- commit the key anywhere.

`NEXT_PUBLIC_SOLANA_RPC_URL` stays the public, keyless placeholder
(`https://api.mainnet-beta.solana.com`).

> Without this secret, the production balance route fails soft
> (`{ ok:false, error:"rpc_not_configured" }`, HTTP 503) — so set it first.

---

## 4. Local validation before deploy (real exit codes — do not tail-mask)

```bash
npm run lint                 # release-lint incl. P3A-RPC + fail-soft invariants
npm run guard:no-agent-gates
npm run typecheck
npm run build                # next build
npm run test:audit-policy
npm run test:payment-canary
npm run test:solana-transfer # present in this repo
```

Each must exit `0`. Capture exit codes explicitly, e.g.
`npm run lint; echo "EXIT=$?"`. **STOP** on any non-zero.

---

## 5. Build and deploy P3A only

```bash
# Build the OpenNext bundle against the P3A config:
npx opennextjs-cloudflare build  --config wrangler.workers.p3a.jsonc

# Deploy ONLY the ahin-io-p3a worker (never the root ahin-io worker):
npx opennextjs-cloudflare deploy --config wrangler.workers.p3a.jsonc
```

The deploy prints the Worker URL, e.g. `https://ahin-io-p3a.<subdomain>.workers.dev`.
Record it as `DEPLOYED_URL` for the smoke tests.

- Use the printed `*.workers.dev` URL for smoke. Binding the `p3a.ahin.io`
  subdomain is **optional and separate**; it must never rebind root `ahin.io`
  or the `ahin-io` worker.

---

## 6. Smoke tests (readonly — no signature, no transaction, no transfer)

```bash
DEPLOYED_URL="https://ahin-io-p3a.<subdomain>.workers.dev"   # from step 5
KNOWN_WALLET="<a base58 wallet known to hold LIFE++>"

# 6a. Worker root returns 200 and serves live-readonly / mainnet-beta UI.
curl -s -o /dev/null -w "%{http_code}\n" "$DEPLOYED_URL"          # EXPECT 200
curl -s "$DEPLOYED_URL" | grep -Eo "Mainnet readonly mode|mainnet-beta|readonly" | sort -u
# EXPECT readonly/mainnet-beta copy present.

# 6b. Balance route works for a known wallet via the SERVER-SIDE secret.
curl -s "$DEPLOYED_URL/api/solana/lifepp-balance?wallet=$KNOWN_WALLET" | jq .
# EXPECT: { "ok": true, "rawBalance": "<u64>", "decimals": 9,
#           "rpcSource": "secret_binding" }

# 6c. Response must NOT contain the RPC URL / api-key / provider host.
curl -s "$DEPLOYED_URL/api/solana/lifepp-balance?wallet=$KNOWN_WALLET" \
  | grep -iE "helius|triton|quiknode|alchemy|api-key|http" && echo "LEAK!" || echo "no rpc url in response"
# EXPECT: "no rpc url in response"

# 6d. Missing / invalid wallet fail cleanly (no 500, no stack trace).
curl -s -o /dev/null -w "%{http_code}\n" "$DEPLOYED_URL/api/solana/lifepp-balance"            # EXPECT 400 (missing_wallet_param)
curl -s -o /dev/null -w "%{http_code}\n" "$DEPLOYED_URL/api/solana/lifepp-balance?wallet=nope" # EXPECT 400 (invalid_wallet_address)

# 6e. Dev routes must 404 in production.
curl -s -o /dev/null -w "%{http_code}\n" "$DEPLOYED_URL/api/dev/lifepp-balance?wallet=$KNOWN_WALLET"  # EXPECT 404

# 6f. Client bundle must not embed the paid RPC (post-build, local assets).
grep -R -iE "helius|triton|quiknode|alchemy|api-key" .open-next/assets || echo "client bundle clean"
# EXPECT: "client bundle clean"
```

**Manual UI checks (in a browser at `DEPLOYED_URL`):**
- Connect a Solana wallet → the readonly banner shows; balance/eligibility read
  succeeds via the server route.
- **No signature popup appears.** **No transaction is submitted.** No LIFE++ moves.
- The deposit/payment module renders the readonly/dry-run copy only.

**Root domain untouched (confirm separately):**
```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://ahin.io"   # EXPECT 200, unchanged content
gh run list --repo poccahin/AHIN --limit 5 \
  --json workflowName,event,conclusion,headSha   # no new root-production deploy run
```

**STOP and roll back** (section 7) if: balance route leaks the URL, returns 500,
a signature is requested, any transaction is submitted, or root `ahin.io` changed.

---

## 7. Rollback

Rollback is non-destructive and never re-enables any execution path.

```bash
# Option A — rotate or remove the RPC secret (route then fails soft, readonly):
npx wrangler secret put    SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc   # rotate
npx wrangler secret delete SOLANA_RPC_URL --config wrangler.workers.p3a.jsonc   # remove

# Option B — redeploy the previous P3A bundle (from a previous good build), OR
#            tear down the separate P3A worker entirely:
npx wrangler delete --name ahin-io-p3a   # deletes ONLY the ahin-io-p3a worker
```

Invariants during/after rollback:
- Transfer / burn / signing / canary / public-payment flags remain **false**.
- Root `ahin.io` and the `ahin-io` worker are **never** touched.
- The default `wrangler.workers.jsonc` (devnet/mock) is unaffected.

---

## 8. Final report template

After the run, copy the template to the canonical path and fill the `<FILL: …>`
fields. The `false` safety invariants must remain `false` — if any would be
`true`, the run failed its boundary and must be rolled back.

```bash
cp reports/ahin-p3a-mainnet-readonly-live-ui-run.template.json \
   reports/ahin-p3a-mainnet-readonly-live-ui-run.json
# then edit reports/ahin-p3a-mainnet-readonly-live-ui-run.json
```

Template lives at `reports/ahin-p3a-mainnet-readonly-live-ui-run.template.json`
(created alongside this runbook). Required fields:

- `phase`, `status`, `deployedUrl`
- `rootDomainTouched = false`
- `mainnetRpcConfigured = true`
- `transferArmed = false`
- `canaryEnabled = false`
- `publicPaymentEnabled = false`
- `burnEnabled = false`
- `signingEnabled = false`
- `transactionSubmissionEnabled = false`
- `treasuryMutationEnabled = false`
- `balanceReadSmokeResult`
- `eligibilitySmokeResult`
- `rpcUrlExposed = false`
- `rollbackInstructions`

---

## Boundary

P3A-Run is **readonly**. P3B (single foundation-wallet micro-transfer) remains
**BLOCKED** and additionally requires: allowlist + per-payment cap + kill-switch
drill + out-of-band mint/treasury/ATA verification + explicit operator
authorization. Do not proceed to P3B from this runbook.
