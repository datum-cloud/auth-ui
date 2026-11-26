#!/usr/bin/env bash
# Refreshes the vendored disposable-email domain list used by the sign-up check
# (app/resources/signup/disposable-email.ts).
#
# Usage: scripts/update-disposable-domains.sh <upstream-commit-sha>
#
# Source: disposable_email_blocklist.conf from
# https://github.com/disposable-email-domains/disposable-email-domains (CC0 1.0).
# Pinned to a full commit SHA so every refresh is a reviewable diff. The download is
# treated as data: each line must look like a domain name, or the script refuses to
# write anything.
set -euo pipefail

REPO="disposable-email-domains/disposable-email-domains"
FILE="disposable_email_blocklist.conf"
OUT="app/resources/signup/data/disposable-email-domains.txt"

sha="${1:-}"
if [[ ! "${sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <40-character upstream commit sha>" >&2
  exit 2
fi

url="https://raw.githubusercontent.com/${REPO}/${sha}/${FILE}"
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

curl --fail --silent --show-error --location --proto '=https' --max-time 60 \
  --output "${tmp}" "${url}"

# Lowercase, trim, drop blanks and comments, then require every remaining line to be a
# plain domain name: letters, digits, hyphens and dots, at least two labels.
cleaned="$(
  LC_ALL=C tr '[:upper:]' '[:lower:]' <"${tmp}" |
    LC_ALL=C sed -e 's/[[:space:]]*$//' -e 's/^[[:space:]]*//' |
    LC_ALL=C grep -v -e '^$' -e '^#' |
    LC_ALL=C sort -u
)"

bad="$(printf '%s\n' "${cleaned}" |
  LC_ALL=C grep -v -E '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || true)"
if [[ -n "${bad}" ]]; then
  echo "refusing to write ${OUT}: lines that are not domain names:" >&2
  printf '%s\n' "${bad}" | head -n 10 >&2
  exit 1
fi

count="$(printf '%s\n' "${cleaned}" | wc -l | tr -d ' ')"
if ((count < 1000)); then
  echo "refusing to write ${OUT}: only ${count} domains, expected thousands" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUT}")"
{
  echo "# Source: https://github.com/${REPO}/blob/${sha}/${FILE} (CC0 1.0)"
  echo "# Commit: ${sha}. Regenerate with scripts/update-disposable-domains.sh; do not edit by hand."
  printf '%s\n' "${cleaned}"
} >"${OUT}"

echo "wrote ${count} domains to ${OUT}"
