#!/usr/bin/env bash
# =============================================================================
#  Tier-aware docker compose wrapper.
#
#    ./scripts/compose.sh local up -d --build
#    ./scripts/compose.sh preproduction logs -f backend
#    ./scripts/compose.sh production pull
#
#  Guarantees the correct --env-file and overlay are always paired, which is
#  the single most common deployment mistake this wrapper exists to prevent.
# =============================================================================
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TIER="${1:-}"
shift || true

case "$TIER" in
  local|preproduction|production) ;;
  *)
    echo "Usage: $0 <local|preproduction|production> <compose args...>" >&2
    exit 2
    ;;
esac

ENV_FILE=".env.${TIER}"
OVERLAY="docker-compose.${TIER}.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.example and fill it in first." >&2
  exit 1
fi

# Refuse to deploy the non-local tiers while placeholders remain.
if [[ "$TIER" != "local" ]] && grep -q 'CHANGE_ME' "$ENV_FILE"; then
  echo "Refusing to run: $ENV_FILE still contains CHANGE_ME placeholders." >&2
  echo "Resolve them from the secret manager first - see docs/guides/secrets-management.md." >&2
  exit 1
fi

# Production must pin an immutable tag.
if [[ "$TIER" == "production" ]]; then
  TAG="$(grep -E '^IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- || true)"
  if [[ -z "$TAG" || "$TAG" == "latest" ]]; then
    echo "Refusing to run: production requires an immutable IMAGE_TAG (got '${TAG:-<empty>}')." >&2
    exit 1
  fi
fi

exec docker compose \
  --env-file "$ENV_FILE" \
  -f docker-compose.yml \
  -f "$OVERLAY" \
  "$@"
