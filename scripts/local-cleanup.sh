#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WITH_DOCKER=0

if [[ "${1:-}" == "--with-docker" ]]; then
  WITH_DOCKER=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--with-docker]" >&2
  exit 1
fi

cd "$ROOT_DIR"

CLEAN_PATHS=(
  "node_modules"
  "apps/web/node_modules"
  ".npm-cache"
  ".next"
  "apps/web/.next"
  "dist"
  "dist-app"
  "output"
  "tmp"
  ".tmp"
  "temp_verification_out"
  ".playwright-cli"
  "apps/web/tsconfig.tsbuildinfo"
)

echo "Cleaning local artifacts in $ROOT_DIR"

removed_any=0
for path in "${CLEAN_PATHS[@]}"; do
  if [[ -e "$path" ]]; then
    rm -rf "$path"
    echo "  removed $path"
    removed_any=1
  fi
done

if [[ "$removed_any" -eq 0 ]]; then
  echo "  nothing to remove"
fi

if command -v git >/dev/null 2>&1; then
  git reflog expire --expire=now --all >/dev/null 2>&1 || true
  git gc --prune=now >/dev/null 2>&1 || true
  echo "  git gc completed"
fi

if [[ "$WITH_DOCKER" -eq 1 ]]; then
  if command -v docker >/dev/null 2>&1; then
    docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    echo "  docker compose volumes cleaned"
  else
    echo "  docker not found; skipped docker cleanup"
  fi
fi

echo "Local cleanup done."
