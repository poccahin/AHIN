#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f "wrangler.toml" ]]; then
  echo "BLOCKED: wrangler.toml is required for preview deployment." >&2
  exit 1
fi

toml_var() {
  local key="$1"
  awk -F= -v key="$key" '
    $1 ~ "^[[:space:]]*" key "[[:space:]]*$" {
      value = $2
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^"|"$/, "", value)
      print value
      exit
    }
  ' wrangler.toml
}

value_or_toml() {
  local key="$1"
  local env_value="${!key:-}"
  if [[ -n "$env_value" ]]; then
    printf '%s' "$env_value"
  else
    toml_var "$key"
  fi
}

require_value() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(value_or_toml "$key")"
  if [[ "$actual" != "$expected" ]]; then
    echo "BLOCKED: ${key} must be ${expected}, got '${actual:-missing}'." >&2
    exit 1
  fi
}

require_value "AHIN_ORACLE_MODE" "readonly"
require_value "AHIN_PROTOCOL_EXECUTION_ENABLED" "false"
require_value "AHIN_REAL_USAGE_FEE_TRANSFER" "false"
require_value "AHIN_REAL_WALLET_VERIFICATION" "false"

target_domain="$(value_or_toml "NEXT_PUBLIC_AHIN_TARGET_DOMAIN")"
if [[ "$target_domain" == "ahin.io" ]]; then
  echo "BLOCKED: root ahin.io deployment is not allowed by this Phase 4B preview script." >&2
  exit 1
fi

if grep -qE '<REAL_PREVIEW_KV_NAMESPACE_ID>|<PRODUCTION_KV_NAMESPACE_ID>|<PREVIEW_KV_NAMESPACE_ID>' wrangler.toml; then
  echo "BLOCKED: KV namespace placeholder is still present in wrangler.toml." >&2
  exit 1
fi

if ! grep -q 'binding[[:space:]]*=[[:space:]]*"AHIN_ORACLE_KV"' wrangler.toml; then
  echo "BLOCKED: AHIN_ORACLE_KV binding is required." >&2
  exit 1
fi

npm run lint
npm run typecheck
npm run build
npm run guard:no-agent-gates
npm audit --omit=dev

output_dir="${AHIN_CLOUDFLARE_OUTPUT_DIR:-out}"
project_name="${AHIN_CLOUDFLARE_PROJECT:-ahin-gate-preview}"
branch_name="${AHIN_CLOUDFLARE_PREVIEW_BRANCH:-preview}"

if [[ "$branch_name" == "main" || "$branch_name" == "production" ]]; then
  echo "BLOCKED: preview script refuses branch '${branch_name}'." >&2
  exit 1
fi

if [[ ! -d "$output_dir" ]]; then
  echo "BLOCKED: build output directory '${output_dir}' does not exist." >&2
  exit 1
fi

npx wrangler pages deploy "$output_dir" --project-name "$project_name" --branch "$branch_name"
