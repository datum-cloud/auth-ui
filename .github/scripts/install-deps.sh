#!/usr/bin/env bash
# Installs from the committed lockfile. When the lockfile does not match
# package.json, report the cause and the fix instead of bun's bare
# "lockfile had changes, but lockfile is frozen".
set -uo pipefail

if bun install --frozen-lockfile; then
  exit 0
fi

echo "::group::Lockfile drift"
bun install --lockfile-only >/dev/null 2>&1 || true
git --no-pager diff --stat -- bun.lock || true
echo "::endgroup::"

echo "::error title=Lockfile out of sync with package.json::package.json changed without a matching bun.lock. Run 'bun install' locally and commit bun.lock. Upgrade bots that cannot write Bun lockfiles always land here: see https://github.com/datum-cloud/auth-ui/issues/123"
exit 1
