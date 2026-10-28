#!/usr/bin/env bash
# Fast e2e: build once, then run each spec against its own fresh server in
# Chrome. A fresh server per spec keeps the in-memory WebAuthn rate limiter
# (10 POSTs / 5 min / IP) from tripping across the passkey specs.
# Override the port locally with E2E_PORT (default 3000).
set -euo pipefail

PORT="${E2E_PORT:-3000}"
ORIGIN="http://localhost:${PORT}"
SPECS=(
  cypress/e2e/core-signin.cy.ts
  cypress/e2e/login-hydrated-submit.cy.ts
  cypress/e2e/passkey-use.cy.ts
  cypress/e2e/passkey-discovery.cy.ts
  cypress/e2e/passkey-conditional.cy.ts
  cypress/e2e/signup-passkey.cy.ts
  cypress/e2e/reauth.cy.ts
  cypress/e2e/setup-passkey-mfa.cy.ts
  cypress/e2e/security-key-use.cy.ts
)

npm run build

for spec in "${SPECS[@]}"; do
  echo "==> ${spec}"
  AUTH_PROVIDER=fake PORT="${PORT}" PUBLIC_ORIGIN="${ORIGIN}" \
    npx --no-install start-server-and-test 'npm run start' "http-get://localhost:${PORT}/healthz" \
    "npx --no-install cypress run --browser chrome --config baseUrl=${ORIGIN} --spec ${spec}"
done
