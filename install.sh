#!/usr/bin/env bash
# SupplAIGuard global installer.
#
# Kiro CLI only discovers workspace agents in the *current* directory's
# .kiro/agents. To run SupplAIGuard from ANY repository, this script installs
# the agents globally (~/.kiro/agents) and the policies/skills they reference
# under ~/.kiro/supplaiguard/ (kept out of ~/.kiro/steering so they are not
# injected into unrelated chats).
#
# Usage:  ./install.sh [--dry-run] | ./install.sh --uninstall
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIRO_HOME="${KIRO_HOME:-$HOME/.kiro}"
AGENTS_DST="$KIRO_HOME/agents"
SG_DST="$KIRO_HOME/supplaiguard"
DRY=0
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

run() { if [ "$DRY" -eq 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

if [ "$UNINSTALL" -eq 1 ]; then
  for f in "$SRC"/.kiro/agents/supplaiguard-*.json; do
    run rm -f "$AGENTS_DST/$(basename "$f")"
  done
  for p in "$SRC"/.kiro/agents/prompts/*.md; do
    run rm -f "$AGENTS_DST/prompts/$(basename "$p")"
  done
  run rm -rf "$SG_DST"
  echo "SupplAIGuard uninstalled from $KIRO_HOME"
  exit 0
fi

command -v kiro-cli >/dev/null || echo "WARN: kiro-cli not found on PATH" >&2

run mkdir -p "$AGENTS_DST/prompts" "$SG_DST/steering" "$SG_DST/skills"

# Policies and skills the agents load via file://~/.kiro/supplaiguard/...
run cp -f "$SRC"/.kiro/steering/*.md "$SG_DST/steering/"
for d in "$SRC"/.kiro/skills/sg-*/; do
  run mkdir -p "$SG_DST/skills/$(basename "$d")"
  run cp -f "$d"SKILL.md "$SG_DST/skills/$(basename "$d")/SKILL.md"
done

# Deterministic scanner the threat-analysis and verification agents run first
run mkdir -p "$SG_DST/scanner"
run cp -f "$SRC"/scanner/sg_scan.py "$SG_DST/scanner/sg_scan.py"

# Agent prompts (referenced relatively as ./prompts/*.md)
run cp -f "$SRC"/.kiro/agents/prompts/*.md "$AGENTS_DST/prompts/"

# Agent configs. The reviewer reads this repo's spec, so point it at the
# absolute checkout path instead of a cwd-relative one.
for f in "$SRC"/.kiro/agents/supplaiguard-*.json; do
  dst="$AGENTS_DST/$(basename "$f")"
  if [ "$DRY" -eq 1 ]; then
    echo "[dry-run] install $f -> $dst"
  else
    sed "s#file://\.kiro/specs/#file://$SRC/.kiro/specs/#" "$f" > "$dst"
    kiro-cli agent validate --path "$dst" >/dev/null
  fi
done

cat <<EOF

SupplAIGuard installed.
  agents : $AGENTS_DST/supplaiguard-*.json
  assets : $SG_DST

Run from ANY repository:
  cd /path/to/repo
  kiro-cli chat --agent supplaiguard-coordinator "Run a full SupplAIGuard scan."
EOF
