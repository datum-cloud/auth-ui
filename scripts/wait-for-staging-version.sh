#!/usr/bin/env bash
# Wait until <origin>/id/version reports <expected-version>. Build versions look like
# v0.0.0-main-YYYYMMDD-HHmmss, so a plain string comparison orders them by time: a newer
# version means a later merge superseded this one, which counts as live.
set -euo pipefail

if [[ $# -ne 2 || -z "$1" || -z "$2" ]]; then
  echo "::error::usage: $0 <origin> <expected-version> (both non-empty)"
  exit 2
fi

ORIGIN="${1%/}"
EXPECTED="$2"
TIMEOUT="${WAIT_TIMEOUT_SECONDS:-900}"
INTERVAL=15
deadline=$((SECONDS + TIMEOUT))

while true; do
  body="$(curl -fsS --max-time 10 "${ORIGIN}/id/version" 2>/dev/null || true)"
  current="$(printf '%s' "$body" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  echo "staging reports '${current:-<unreachable>}', waiting for '${EXPECTED}'"

  if [[ "$current" == "$EXPECTED" ]]; then
    echo "Build ${EXPECTED} is live on staging"
    exit 0
  fi
  if [[ -n "$current" && "$current" > "$EXPECTED" ]]; then
    echo "::warning::Staging runs ${current}, newer than ${EXPECTED}; testing that build"
    exit 0
  fi
  if (( SECONDS + INTERVAL > deadline )); then
    echo "::error::Build ${EXPECTED} never went live on staging (last seen: ${current:-<unreachable>})"
    exit 1
  fi
  sleep "$INTERVAL"
done
