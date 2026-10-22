#!/usr/bin/env bash
set -euo pipefail

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT
report=$(npm audit --json 2>"$errors" || true)

if [[ "$(jq -r '.auditReportVersion // empty' <<<"$report" 2>/dev/null)" != 2 ]]; then
  echo "npm audit returned no report:" >&2
  printf '%s\n' "$report" >&2
  cat "$errors" >&2
  exit 1
fi

advisories=$(jq -r '
  [.vulnerabilities[].via[] | objects
    | "\(.url | sub(".*/"; ""))\t\(.severity)\t\(.name) \(.range)\t\(.title)"]
  | unique[]' <<<"$report")

for id in "$@"; do
  if ! grep -q "^${id}"$'\t' <<<"$advisories"; then
    echo "note: ignored advisory ${id} is no longer reported; drop it from the ignore list"
  fi
done

failing=$(awk -F'\t' -v ignored="$*" '
  BEGIN { n = split(ignored, ids, " "); for (i = 1; i <= n; i++) skip[ids[i]] = 1 }
  NF && !($1 in skip)
' <<<"$advisories")

if [[ -n "$failing" ]]; then
  echo "npm audit found advisories that are not ignored:" >&2
  printf '%s\n' "$failing" >&2
  exit 1
fi

echo "npm audit: no advisories beyond the ignore list ($*)"
