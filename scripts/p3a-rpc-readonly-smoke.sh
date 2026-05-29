#!/usr/bin/env bash
#
# p3a-rpc-readonly-smoke.sh — Phase P3A RPC readonly smoke test.
#
# READONLY ONLY. This script performs HTTP GETs against the deployed P3A
# worker's balance endpoint. It NEVER builds, signs, submits, or broadcasts a
# transaction; it cannot mutate the treasury or any on-chain state; it requests
# no wallet signature. Safe to run repeatedly.
#
# Usage:
#   scripts/p3a-rpc-readonly-smoke.sh [WORKER_URL] [KNOWN_ONCURVE_WALLET]
# or via env:
#   P3A_WORKER_URL=... P3A_KNOWN_WALLET=... scripts/p3a-rpc-readonly-smoke.sh
#
# Exit code: 0 if all checks pass, non-zero if any check fails.
#
# Expected GREEN state (after the RPC 403 is resolved by pointing
# SOLANA_RPC_URL at a Worker-egress-permitting provider, and the diagnostics
# fix is deployed):
#   - root 200, valid wallet ok=true, treasury PDA ok=true,
#     missing/invalid wallet -> 400, rpcSource=secret_binding, no leaks.
# A 403 today is EXPECTED to fail this smoke (that is the signal migration is
# incomplete) — the script exits non-zero, which is correct.

set -uo pipefail

WORKER_URL="${1:-${P3A_WORKER_URL:-https://ahin-io-p3a.doovvvai.workers.dev}}"
KNOWN_WALLET="${2:-${P3A_KNOWN_WALLET:-J8ez8GMsHtd8x4ucd1Q1LuA1k4GJ9dHYFVoa3PpetFDu}}"
# Canonical AHIN treasury (immutable, off-curve Squads multisig PDA).
TREASURY="5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo"
BAL="${WORKER_URL%/}/api/solana/lifepp-balance"

# --- dependency check -------------------------------------------------------
for dep in curl jq; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    echo "FATAL: required dependency '$dep' not found on PATH." >&2
    exit 2
  fi
done

CURL=(curl -sS --max-time 20)
fail=0
pass() { echo "PASS: $1"; }
bad()  { echo "FAIL: $1"; fail=1; }

# Reject any response that leaks an RPC URL / api-key, or is an HTML error page.
assert_safe_body() {
  local body="$1" label="$2"
  if printf '%s' "$body" | grep -qiE 'https://|api-key|apikey'; then
    bad "$label: possible RPC URL / api-key leak in response body"
  else
    pass "$label: no leaked URL / api-key"
  fi
  if printf '%s' "$body" | grep -qiE '<!doctype html|<html'; then
    bad "$label: HTML error page instead of JSON"
  fi
}

jqr() { printf '%s' "$1" | jq -r "$2" 2>/dev/null; }

echo "=== P3A RPC readonly smoke ==="
echo "worker:   $WORKER_URL"
echo "wallet:   $KNOWN_WALLET"
echo "treasury: $TREASURY"
echo "---"

# 1. Worker health: root returns 200.
code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$WORKER_URL")
if [ "$code" = "200" ]; then pass "root worker 200"; else bad "root worker expected 200, got $code"; fi

# 2. Valid (on-curve) wallet read -> ok=true.
body=$("${CURL[@]}" "$BAL?wallet=$KNOWN_WALLET")
ok=$(jqr "$body" '.ok'); src=$(jqr "$body" '.rpcSource')
if [ "$ok" = "true" ]; then
  pass "valid wallet read ok=true (rawBalance=$(jqr "$body" '.rawBalance'))"
else
  bad "valid wallet read not ok (code=$(jqr "$body" '.diagnosticCode // .error'))"
fi
if [ -n "$src" ] && [ "$src" != "null" ]; then pass "rpcSource present ($src)"; else bad "rpcSource missing"; fi
assert_safe_body "$body" "valid wallet"

# 3. Treasury off-curve PDA read -> ok=true (queryable) or a clear diagnostic.
body=$("${CURL[@]}" "$BAL?wallet=$TREASURY")
ok=$(jqr "$body" '.ok')
if [ "$ok" = "true" ]; then
  pass "treasury PDA read ok=true (rawBalance=$(jqr "$body" '.rawBalance'))"
else
  bad "treasury PDA read not ok (code=$(jqr "$body" '.diagnosticCode // .error'))"
fi
assert_safe_body "$body" "treasury"

# 4. Missing wallet -> 400 missing_wallet_param.
code=$("${CURL[@]}" -o /tmp/p3a_smoke_mw.json -w '%{http_code}' "$BAL")
err=$(jqr "$(cat /tmp/p3a_smoke_mw.json 2>/dev/null)" '.error')
if [ "$code" = "400" ] && [ "$err" = "missing_wallet_param" ]; then
  pass "missing wallet -> 400 missing_wallet_param"
else
  bad "missing wallet expected 400/missing_wallet_param, got $code/$err"
fi

# 5. Invalid wallet -> 400 invalid_wallet_address.
code=$("${CURL[@]}" -o /tmp/p3a_smoke_iw.json -w '%{http_code}' "$BAL?wallet=bad")
err=$(jqr "$(cat /tmp/p3a_smoke_iw.json 2>/dev/null)" '.error')
if [ "$code" = "400" ] && [ "$err" = "invalid_wallet_address" ]; then
  pass "invalid wallet -> 400 invalid_wallet_address"
else
  bad "invalid wallet expected 400/invalid_wallet_address, got $code/$err"
fi

echo "---"
if [ "$fail" -ne 0 ]; then
  echo "P3A RPC READONLY SMOKE: FAIL"
  echo "(A 403 here means SOLANA_RPC_URL still points at an endpoint that blocks"
  echo " Cloudflare Worker egress — rotate the secret per the migration runbook.)"
  exit 1
fi
echo "P3A RPC READONLY SMOKE: PASS"
exit 0
