#!/usr/bin/env bash
set -euo pipefail

AGENT_ROOT="${1:-src/agents}"

if [[ ! -d "$AGENT_ROOT" ]]; then
  exit 0
fi

forbidden_pattern='(signMessage|personal_sign|eth_sendTransaction|sendTransaction|signAndSendTransaction|Gatekeeper|proofOfAssets|entryFee|connectWallet|requestAccounts)'

if grep -RInE "$forbidden_pattern" "$AGENT_ROOT" \
  --exclude-dir legacy \
  --exclude-dir node_modules \
  --exclude '*.md'; then
  printf '\nForbidden secondary gatekeeping logic found under %s\n' "$AGENT_ROOT" >&2
  exit 1
fi

printf 'No secondary gatekeeping logic found under %s\n' "$AGENT_ROOT"
