#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
LEGACY_SOURCE_DIR="${2:-$ROOT_DIR}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
BACKUP_DIR="$ROOT_DIR/backup_archive"
ARCHIVE_PATH="$BACKUP_DIR/chippmf_legacy_${TIMESTAMP}.tar.gz"
STAGING_DIR="$(mktemp -d)"
MANIFEST_PATH="$BACKUP_DIR/chippmf_legacy_${TIMESTAMP}.manifest"

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"

copy_if_exists() {
  local source_path="$1"
  local target_path="$2"

  if [[ -e "$source_path" ]]; then
    mkdir -p "$(dirname "$target_path")"
    cp -R "$source_path" "$target_path"
    printf '%s\n' "$source_path" >> "$MANIFEST_PATH"
  fi
}

collect_chippmf_legacy() {
  : > "$MANIFEST_PATH"
  local legacy_seed_found=0

  local roots=(
    "$LEGACY_SOURCE_DIR/src/works"
    "$LEGACY_SOURCE_DIR/src/pages"
    "$LEGACY_SOURCE_DIR/src/app/chippmf"
    "$LEGACY_SOURCE_DIR/app/chippmf"
    "$LEGACY_SOURCE_DIR/components/chippmf"
    "$LEGACY_SOURCE_DIR/components/ahin"
  )

  for root in "${roots[@]}"; do
    [[ -e "$root" ]] || continue
    legacy_seed_found=1
    local relative="${root#$LEGACY_SOURCE_DIR/}"
    copy_if_exists "$root" "$STAGING_DIR/$relative"
  done

  if [[ "$legacy_seed_found" -eq 0 ]]; then
    printf 'No chippmf route roots found under %s\n' "$LEGACY_SOURCE_DIR" > "$STAGING_DIR/NO_LEGACY_FILES_FOUND.txt"
    printf 'NO_LEGACY_FILES_FOUND %s\n' "$LEGACY_SOURCE_DIR" > "$MANIFEST_PATH"
    return
  fi

  local filtered_roots=(
    "$LEGACY_SOURCE_DIR/src"
    "$LEGACY_SOURCE_DIR/lib"
    "$LEGACY_SOURCE_DIR/hooks"
    "$LEGACY_SOURCE_DIR/store"
  )

  for root in "${filtered_roots[@]}"; do
    [[ -d "$root" ]] || continue
    while IFS= read -r path; do
      local relative="${path#$LEGACY_SOURCE_DIR/}"
      copy_if_exists "$path" "$STAGING_DIR/$relative"
    done < <(
      find "$root" \
        \( -iname '*chippmf*' -o -iname '*ahin*' -o -iname '*admission*' -o -iname '*gatekeeper*' -o -iname '*cloudflare*' \) \
        -not -path '*/node_modules/*' \
        -not -path '*/.next/*' \
        -not -path '*/dist/*' \
        -not -path '*/build/*'
    )
  done

  if [[ ! -s "$MANIFEST_PATH" ]]; then
    printf 'No chippmf legacy files found under %s\n' "$LEGACY_SOURCE_DIR" > "$STAGING_DIR/NO_LEGACY_FILES_FOUND.txt"
    printf 'NO_LEGACY_FILES_FOUND %s\n' "$LEGACY_SOURCE_DIR" > "$MANIFEST_PATH"
  fi
}

create_agent_dirs() {
  mkdir -p \
    "$ROOT_DIR/src/agents/fire_orange/godsignal" \
    "$ROOT_DIR/src/agents/purple_rule" \
    "$ROOT_DIR/src/agents/blue_water/legacy" \
    "$ROOT_DIR/src/agents/gold_contract" \
    "$ROOT_DIR/src/agents/green_eco"
}

migrate_blue_water() {
  if [[ -d "$STAGING_DIR/src" || -d "$STAGING_DIR/app" || -d "$STAGING_DIR/components" || -d "$STAGING_DIR/lib" || -d "$STAGING_DIR/store" || -d "$STAGING_DIR/hooks" ]]; then
    cp -R "$STAGING_DIR/." "$ROOT_DIR/src/agents/blue_water/legacy/"
  fi
}

init_godsignal_scaffold() {
  local engine_path="$ROOT_DIR/src/agents/fire_orange/godsignal/engine.ts"
  if [[ -e "$engine_path" ]]; then
    return
  fi

  cat > "$engine_path" <<'EOF'
export interface GodsignalInput {
  operatorId: string;
  signal: string;
  observedAt: string;
}

export interface GodsignalDecision {
  cluster: "fire_orange";
  engine: "godsignal";
  accepted: boolean;
  reason: string;
  traceId: string;
}

export function evaluateGodsignal(input: GodsignalInput): GodsignalDecision {
  const normalizedSignal = input.signal.trim();
  return {
    cluster: "fire_orange",
    engine: "godsignal",
    accepted: normalizedSignal.length > 0,
    reason: normalizedSignal.length > 0 ? "SIGNAL_PRESENT" : "EMPTY_SIGNAL",
    traceId: `${input.operatorId}:${input.observedAt}`
  };
}
EOF
}

write_sha256_manifest() {
  local digest_path="$BACKUP_DIR/chippmf_legacy_${TIMESTAMP}.sha256"
  shasum -a 256 "$ARCHIVE_PATH" > "$digest_path"
}

collect_chippmf_legacy
tar -C "$STAGING_DIR" -czf "$ARCHIVE_PATH" .
create_agent_dirs
migrate_blue_water
init_godsignal_scaffold
write_sha256_manifest

cat <<EOF
backup_archive=$ARCHIVE_PATH
manifest=$MANIFEST_PATH
blue_water_legacy=$ROOT_DIR/src/agents/blue_water/legacy
godsignal=$ROOT_DIR/src/agents/fire_orange/godsignal
EOF
