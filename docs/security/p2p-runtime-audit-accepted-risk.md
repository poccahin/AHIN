# Phase P2P-A — Runtime Audit Accepted-Risk Decision Pack

**Status: `OPERATOR_APPROVED`**
**Issued:** 2026-05-27
**Signed:** 2026-05-28 by Lee / AHIN Operator
**Approval valid until:** 2026-06-27 (30 days — Phase P2P-B operator decision)
**Companion JSON:** [`reports/ahin-p2p-audit-accepted-risk.json`](../../reports/ahin-p2p-audit-accepted-risk.json)
**Audit triage:** [`reports/ahin-p2p-runtime-audit-triage.json`](../../reports/ahin-p2p-runtime-audit-triage.json)

---

## 1. Scope

This document records the operator decision to accept residual risk from a specific, exhaustively-enumerated set of transitive vulnerabilities in the Solana JS ecosystem that block `npm audit --omit=dev` from passing.

**This document does NOT, on its own:**
- Change CI policy. `npm audit` remains a blocking gate until a separate, explicitly-authorized policy commit lands.
- Flip any runtime flag. All AND-of-explicit-env-flags remain disarmed.
- Authorize push, deploy, workflow dispatch, transfer, burn, signing, or treasury mutation.

**This document IS:**
- The formal artifact that future CI-policy work can consult to decide whether to treat the listed advisory IDs as advisory-only-warn.
- The reviewable, signable record of the reasoning for why these specific advisories should not block forever.

If the audit endpoint flags advisories outside the listed set, this pack does NOT cover them and `npm audit` should continue to block.

---

## 2. Executive summary

`npm audit --omit=dev` returns exit 1 with two HIGH advisories and three cascading MOD advisories. All five are transitive dependencies inherited via `@solana/web3.js` + `@solana/spl-token`. The Solana team has not yet published clean upstreams. The only mechanical fix npm offers (`audit fix --force`) downgrades `@solana/spl-token` to `0.1.8`, which breaks the modern API surface our code depends on (`createTransferCheckedInstruction`, `getAssociatedTokenAddressSync`).

**The structural argument for accepting:**
1. None of the advisories are reachable from the public root governance UI today (root renders `<Gatekeeper>` → `<AhinGateway>` R3F scene; neither imports the affected chain).
2. None can lead to signing/transfer/burn without all five env flags (`AHIN_PROTOCOL_EXECUTION_ENABLED`, `AHIN_REAL_USAGE_FEE_TRANSFER`, `AHIN_PAYMENT_CANARY_ENABLED`, wallet allowlisted, amount within cap) being explicitly armed. The flags are evaluated at module import via `process.env`; runtime code cannot mutate them.
3. Wallet signing and submission APIs are file-confined and release-lint-enforced.
4. The exploitable functions in the advisories (`toBigIntLE` in bigint-buffer; `uuid.v3/v5/v6` with attacker `buf`) are not invoked by our code with user-controllable inputs.

**The risk the operator is accepting:**
Memory-safety vulnerabilities in code that loads — but cannot be coerced into executing the vulnerable functions on user-controlled bytes — when the Worker imports `@solana/web3.js`. Bounded to JavaScript runtime safety; no signing/transfer/burn capability is exposed.

**What this pack does NOT accept:**
- Any future advisory in a non-Solana-cascade package.
- Any direct-import vulnerability.
- Any advisory that breaks the AND-of-env-flags safety model.
- Any state where the operator's signature has expired (90-day window).

---

## 3. Advisory-by-advisory analysis

### 3.1 `bigint-buffer` — GHSA-3gc7-fjrx-p6mg (HIGH)

**Title:** bigint-buffer Vulnerable to Buffer Overflow via `toBigIntLE()` Function
**Reference:** https://github.com/advisories/GHSA-3gc7-fjrx-p6mg

**Import shape:** transitive.
```
@solana/spl-token (direct)
  └─ @solana/buffer-layout-utils
       └─ bigint-buffer  ← vulnerable
```

**Reachability:**

| Source | Reachable? |
|---|---|
| Root governance UI | **No.** Root renders `<Gatekeeper>` → `<AhinGateway/>`. Neither path constructs RPC objects or invokes `@solana/spl-token`. |
| Without canary flags armed | **Yes, conditionally.** Loaded when `src/lib/lifePlusSolana.ts:readLifePlusBalanceRaw` runs, which happens in the Gatekeeper PoCC check when `gateMode === "live"`. Current env keeps `gateMode=mock` so it is dormant. |
| Can cause signing/transfer/burn without env flags | **No.** Even a memory corruption inside `toBigIntLE` cannot influence `process.env` or the AND-chain evaluation. The gate variables are bound at module-load and re-checked at every payment authorization. |

**Exploitability in this codebase:** Low. The vulnerable function fires on attacker-controlled Buffer arguments to `toBigIntLE`. Our only invocation path is `connection.getTokenAccountBalance(ata)`, where `ata` is a deterministic SPL ATA derived from `(userPubkey, LIFE_PLUS_MINT)`. There is no surface where a user can supply a malformed Buffer that reaches `toBigIntLE`.

**Available fix:** `npm audit fix --force` would install `@solana/spl-token@0.1.8`. **Rejected** because:
- 0.1.8 predates `createTransferCheckedInstruction` and `getAssociatedTokenAddressSync` exports. The build would fail at `tsc`.
- If we patched our code to use the 0.1.x API, we'd lose the checked-decimals validation in transfers — a security regression. The cure is worse than the disease.

**Mitigation in place (release-lint enforced):**
- AND-of-explicit-env-flags safety model blocks signing/transfer/burn regardless of dep behavior.
- Wallet signing API confined to `src/lib/walletAdapters.ts`.
- Transaction submission APIs confined to `src/lib/walletAdapters.ts`.
- `createTransferCheckedInstruction` confined to `src/lib/transactionSolana.ts`.
- Burn instruction path forbidden everywhere.
- `/active-hash` simulator + root governance routes are web3-free.
- Dev API routes 404 in production.
- `gateMode=mock` + `cluster=devnet` keep the `@solana/spl-token` execution path cold in current production env.

**Residual risk:** Memory-safety only. If/when the operator flips `gateMode=live` for P3A (mainnet readonly live-UI test), every Gatekeeper PoCC check would load the vulnerable chain. The risk is bounded to JS runtime memory-safety; no signing/transfer can be coerced through the AND-gate.

**Re-review triggers (any of these forces early re-review, regardless of expiry date):**
- Solana team publishes patched `@solana/spl-token` without bigint-buffer dependency.
- New advisory published against bigint-buffer with a different exploit profile.
- Operator decision to advance to P3B (real foundation-wallet micro-transfer).
- Operator decision to expand canary beyond a single allowlisted wallet.

---

### 3.2 `uuid` <11.1.1 — GHSA-w5hq-g745-h8pq (HIGH)

**Title:** uuid: Missing buffer bounds check in v3/v5/v6 when `buf` is provided
**Reference:** https://github.com/advisories/GHSA-w5hq-g745-h8pq

**Import shape:** transitive.
```
@solana/web3.js (direct)
  └─ uuid  ← vulnerable (<11.1.1)
```

**Reachability:**

| Source | Reachable? |
|---|---|
| Root governance UI | **No.** Same reasoning as bigint-buffer. |
| Without canary flags armed | **Yes.** Loaded any time a `Connection` is constructed (`lifePlusSolana.ts`, `paymentPreflight.ts`, etc.). |
| Can cause signing/transfer/burn without env flags | **No.** Bounds-check bypass in uuid cannot influence env-derived gate flags. |

**Exploitability in this codebase:** Very low. The advisory requires the caller to pass an attacker-controlled `buf` argument to `uuid.v3/v5/v6`. Our code never calls these functions directly. `@solana/web3.js`'s internal usage relies on `uuid.v4`, which is **not affected** by this advisory.

**Available fix:** `uuid >= 11.1.1` via overrides. **Rejected** because `@solana/web3.js` pins an older uuid range; forcing 11.1.1+ may introduce subtle runtime incompatibilities in request correlation that aren't caught at build time. Better to wait for upstream coordination.

**Mitigation:** Same structural mitigations as bigint-buffer, plus: our code never invokes `uuid.v3/v5/v6` directly.

**Residual risk:** Minimal beyond what bigint-buffer already presents. Same upstream-fix dependency.

---

### 3.3 Cascade: `@solana/buffer-layout-utils` (MOD)

Transitive cascade of `bigint-buffer`. Cannot be fixed independently. Same mitigation and re-review triggers as §3.1.

### 3.4 Cascade: `@solana/spl-token` (MOD)

Direct import; severity-cascaded from `@solana/buffer-layout-utils` + `@solana/spl-token-group` + `@solana/spl-token-metadata` + `@solana/web3.js`. Same fix and rejection rationale as §3.1.

### 3.5 Cascade: `@solana/web3.js` (MOD)

Direct import; severity-cascaded from `bigint-buffer` + `uuid`. No actionable fix exists; awaits upstream.

---

## 4. Structural mitigations (release-lint enforced — see `scripts/release-lint.mjs`)

| Mitigation | Where enforced |
|---|---|
| AND-of-explicit-env-flags safety model | `src/config/life-plus.ts` + `src/config/life-plus-payment.ts` |
| `signAndSendTransaction` confined | `src/lib/walletAdapters.ts` |
| Transaction submission APIs confined | `src/lib/walletAdapters.ts` |
| `createTransferCheckedInstruction` confined | `src/lib/transactionSolana.ts` |
| Burn instruction path forbidden | everywhere (regex-checked) |
| Web3 imports confined | approved file set; `/active-hash` + governance routes web3-free |
| Dev routes gated | `src/lib/devRouteGate.ts`; routes return 404 in production |
| `grantAccess` after confirmation only | `src/components/LifePaymentModule.tsx` (3 callsites, all post-confirmation) |
| `PUBLIC_PAYMENT_ENABLED` hardcoded `false` | `src/config/life-plus-payment.ts` |
| `BURN_ENABLED` hardcoded `false` | `src/config/life-plus-payment.ts` |
| Canary defaults disarmed | allowlist empty, cap `0n` |

---

## 5. Decision criteria

The operator should sign this pack **only if** all of the following are true:

1. The structural mitigations in §4 are confirmed in `npm run lint` (currently passing — 54 PASS, 0 FAIL).
2. The operator accepts that the listed five advisories cannot be exploited under the AND-gate model without an unrelated runtime escape.
3. The operator commits to re-review at any of the early-trigger events in §3.1 or §3.2.
4. The operator understands this pack does NOT change CI policy on its own — a separate, future commit is required to make `npm audit` advisory-only-warn for the listed IDs.
5. The operator understands the pack expires 2026-08-25; mandatory re-review on or before that date.

If any of those are false, do NOT sign.

---

## 6. What signing this pack permits

When signed (operator populates `operatorApproval.signedBy` + `signedAt` + `validUntil` in the JSON), a **subsequent**, separately-authorized commit may:

- Modify `scripts/release-lint.mjs` (or an analogous CI-policy file) to consult this pack and treat advisory IDs `GHSA-3gc7-fjrx-p6mg` and `GHSA-w5hq-g745-h8pq` as advisory-only-warn rather than blocking.
- That commit does NOT enable any runtime payment path. It only un-blocks the `npm audit` gate.

What signing does **NOT** permit:
- Push, deploy, or workflow dispatch on the strength of this pack alone.
- Flipping any `AHIN_*` runtime flag.
- Enabling public payment.
- Enabling transfer, burn, or signing.
- Mutating treasury or Squads state.
- Accepting any advisory not listed in §3.

---

## 7. Operator approval block

To sign this pack:

1. Edit [`reports/ahin-p2p-audit-accepted-risk.json`](../../reports/ahin-p2p-audit-accepted-risk.json) and populate:
   - `operatorApproval.signedBy` — your identifier (email, key fingerprint, or PGP id)
   - `operatorApproval.signedAt` — ISO-8601 timestamp at signing
   - `operatorApproval.validUntil` — ISO-8601 expiry (default: 2026-08-25)
2. Add your signature line below in this file:

   ```
   Signed-by: <name or key id>
   Date:      <ISO-8601 date>
   Scope:     bigint-buffer GHSA-3gc7-fjrx-p6mg, uuid GHSA-w5hq-g745-h8pq, and their cascading @solana/* MOD severity entries only.
   Expiry:    2026-08-25
   ```

3. Commit the signed pack:
   ```
   git add reports/ahin-p2p-audit-accepted-risk.json docs/security/p2p-runtime-audit-accepted-risk.md
   git commit -m "security: sign P2P runtime audit accepted-risk pack (operator: <name>)"
   ```

4. (Separate phase) Author the CI-policy commit that consults this pack.

---

## 8. Audit trail

| Date | Action |
|---|---|
| 2026-05-27 | Pack issued. Status `OPERATOR_REVIEW_REQUIRED`. No signature, no CI policy change. |
| _pending_ | Operator review + signature. |
| _pending_ | Separate CI-policy commit (referenced, not co-located). |
| 2026-08-25 | Mandatory re-review (or earlier on any trigger event). |

---

## 9. Signature

```
Signed by:     Lee / AHIN Operator
Signed at:     2026-05-28T03:05:59Z
Valid until:   2026-06-27T03:05:59Z
Scope:         Phase P2P production canary readiness only
Decision:      accepted_risk_for_documented_transitive_solana_advisories_only
Not authorized: public payment, open mainnet transfer, burn, treasury mutation, public rollout
```

This signature accepts residual risk ONLY for the five documented advisories in §3
(bigint-buffer GHSA-3gc7-fjrx-p6mg, uuid GHSA-w5hq-g745-h8pq, and the cascading
`@solana/buffer-layout-utils` / `@solana/spl-token` / `@solana/web3.js` MOD entries).
It does NOT authorize public payment, open mainnet transfer, burn, treasury mutation,
or public rollout. The signed-audit-policy gate (`scripts/check-runtime-audit-policy.mjs`)
enforces that only these advisories pass and that the approval is unexpired.

---

*This document and its companion JSON were prepared as part of Phase P2P-A and signed
as part of Phase P2P-B. No runtime flag, deploy state, treasury, or Squads state was
modified. `npm audit --omit=dev` continues to exit 1; the signed-policy gate is what
allows CI to pass while keeping audit strict against any unaccepted advisory.*
