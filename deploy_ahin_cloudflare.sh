#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# ahin.io safe Cloudflare Pages deploy script
# Version: v2.1.0
# -----------------------------------------------------------------------------

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT_NAME:-ahin-io-core}"
PREVIEW_BRANCH="${AHIN_CLOUDFLARE_PREVIEW_BRANCH:-preview}"
PRODUCTION_BRANCH="${AHIN_CLOUDFLARE_PRODUCTION_BRANCH:-main}"

log() {
  printf "%b\n" "$1"
}

die() {
  log "${RED}BLOCKED:${NC} $1"
  exit 1
}

log "${YELLOW}Initializing ahin.io safe Cloudflare deployment${NC}"
log "--------------------------------------------------------"

log "[1/6] Preflight"

[ -d ".git" ] || die "Current directory is not a git repository."
[ -f "wrangler.toml" ] || die "wrangler.toml is missing."

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "CLOUDFLARE_API_TOKEN is missing."
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || die "CLOUDFLARE_ACCOUNT_ID is missing."

if grep -q "<PRODUCTION_KV_NAMESPACE_ID>" wrangler.toml || grep -q "<PREVIEW_KV_NAMESPACE_ID>" wrangler.toml; then
  die "KV namespace placeholders are still present in wrangler.toml."
fi

export NEXT_PUBLIC_AHIN_ENV="${NEXT_PUBLIC_AHIN_ENV:-preview}"
export NEXT_PUBLIC_AHIN_TARGET_DOMAIN="${NEXT_PUBLIC_AHIN_TARGET_DOMAIN:-gate.ahin.io}"
export NEXT_PUBLIC_AHIN_GATE_MODE="mock"
export NEXT_PUBLIC_AHIN_DEBUG_MATRIX="false"
export NEXT_PUBLIC_AHIN_WALLET_MODE="mock"
export AHIN_PROTOCOL_EXECUTION_ENABLED="false"

[ "$NEXT_PUBLIC_AHIN_GATE_MODE" = "mock" ] || die "Gate mode must remain mock."
[ "$NEXT_PUBLIC_AHIN_DEBUG_MATRIX" = "false" ] || die "Debug Matrix must be false."
[ "$AHIN_PROTOCOL_EXECUTION_ENABLED" = "false" ] || die "Protocol execution must remain disabled."

log "${GREEN}OK:${NC} mock-only deployment context locked."

log "[2/6] Local release gate"
npm install
npm run lint
npm run typecheck
npm run guard:no-agent-gates
npm audit --omit=dev

log "[3/6] Static export build"
rm -rf .next out node_modules/.cache
npm run build
[ -d "out" ] || die "Build did not produce out/."
[ -f "out/index.html" ] || die "out/index.html is missing."

log "[4/6] Cloudflare preflight"
npm run preflight:cloudflare

log "[5/6] Preview deploy"
npx wrangler pages deploy ./out --project-name "$PROJECT_NAME" --branch "$PREVIEW_BRANCH"
log "${GREEN}OK:${NC} preview deployment command completed. Root domain was not targeted."

log "[6/6] Optional root production deploy"
if [ "${AHIN_CLOUDFLARE_DEPLOY_CONFIRM:-}" != "DEPLOY_AHIN_IO_ROOT" ]; then
  log "${YELLOW}SKIPPED:${NC} root production deploy. Set AHIN_CLOUDFLARE_DEPLOY_CONFIRM=DEPLOY_AHIN_IO_ROOT to enable it."
  exit 0
fi

if [ "${AHIN_ROOT_DOMAIN_OVERWRITE_APPROVED:-}" != "true" ]; then
  die "Root overwrite requires AHIN_ROOT_DOMAIN_OVERWRITE_APPROVED=true."
fi

log "${YELLOW}Root production deploy explicitly approved.${NC}"
npx wrangler pages deploy ./out --project-name "$PROJECT_NAME" --branch "$PRODUCTION_BRANCH"

log "========================================================"
log "${GREEN}Deployment command completed.${NC}"
log "Production UI package deployed with mock verification only."
log "Protocol execution remains disabled."
log "========================================================"
