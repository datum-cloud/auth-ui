# Local passkey testing against real Zitadel (A-H1)

Manual integration script for the passkey surfaces (`/id/passkeys`, `/id/reauth`,
`/setup/passkey`) against a **real** Zitadel. CI never runs this: the Cypress
suites cover the same flows on the fake provider (pre-baked credential); this
script is the real-WebAuthn spot check (automated real-Zitadel WebAuthn is
parked — C7).

## 1. Environment requirements

Any local Zitadel works (Kind, docker-compose, dev instance) as long as it
provides:

- A Zitadel instance with a project/app configured for auth-ui and a service
  user PAT.
- Login policy `passwordlessType: ALLOWED`. **This must be set explicitly** —
  verified live: the FirstInstance default is **NOT_ALLOWED** (the proto zero
  value is simply omitted from the policy JSON). Policy updates are idempotent.
- Optionally, an SMTP catcher (e.g. Mailpit) wired as Zitadel's SMTP target for
  the email-OTP reauth step and as a canary for unexpected mail.

## 2. Same-origin WebAuthn proxy (required for real ceremonies)

WebAuthn requires the RP ID to match the page origin. Put auth-ui and Zitadel
behind ONE https origin (mirrors staging's same-host routing) with any local
reverse proxy — e.g. `https://<local-host>/id/*` → the auth-ui dev server on
`:3000`, everything else → Zitadel.

auth-ui `.env` for this setup:

```bash
AUTH_PROVIDER=zitadel
ZITADEL_API_URL=https://<local-host>       # the shared origin
ZITADEL_SERVICE_USER_TOKEN=<service-user PAT>
NODE_EXTRA_CA_CERTS=<your local CA cert, if the proxy uses one>
```

Browse `https://<local-host>/id/login` (RP ID = `<local-host>`). Enroll with a
platform authenticator directly, or with Chrome DevTools → WebAuthn panel →
**virtual authenticator** (`ctap2`, resident keys ON, user verification ON).

## 3. Round-trip checklist (run in order)

| # | Step | Pass criterion |
|---|------|----------------|
| 1 | Policy honored | `/id/setup/passkey` issues a creation challenge (no `passwordless not allowed` error) |
| 2 | Enroll | virtual/platform authenticator completes; the name step pre-fills from AAGUID (or `<Browser> on <OS>`) |
| 3 | List | `/id/passkeys` shows the new row with the chosen name (ListPasskeys round-trip) |
| 4 | Sudo | wait >10 min (or clear the fresh factor) → `/id/passkeys` bounces to `/id/reauth`; re-verify returns |
| 5 | Remove | confirm dialog → row gone (RemovePasskey round-trip); last-method guard refuses when it is the only method |
| 6 | Reauth email-OTP | `/id/reauth?method=otp_email` delivers a code to the SMTP catcher |
| 7 | Mail canary | **no unexpected mail** during steps 1–5 — any surprise message is a flow that silently no-ops in prod (SMTP disabled there); catalogue it for the Phase B pipeline |

- **Created-at:** after enrolling, `/id/passkeys` shows "Added <today's date>" under the
  new passkey's name. This is also the live server-support check for the v2 metadata RPCs
  (SetUserMetadata/ListUserMetadata/DeleteUserMetadata) on the deployed Zitadel.
- **Cleanup:** after removing that passkey, the `passkey:<id>:created` user-metadata key
  is gone (Zitadel console → user → Metadata, or `ListUserMetadata`); pre-existing passkeys
  with no created-at metadata show no date line — expected, no backfill.
- **Cross-device sign-out:** sign in on two devices/browsers as the same user; on one,
  remove a passkey and choose "Sign out other sessions" — the OTHER device's session is
  invalid on next request (Zitadel session deleted). Confirms the session v2 `userIdQuery`
  search AND that the service PAT may delete a session WITHOUT its session token.
- **Sign-out sudo gate:** a `signout-others` POST with a stale (>10 min) session factor bounces
  through `/id/reauth` instead of executing.
  (Sweep completeness is proven only up to one default page of the session search —
  per-user session counts are expected to be tiny; accepted at final review.)
- **Login-flow rework:** with ≥2 methods, the chooser shows "Signing in as <you> — Not you?"
  and the Passkey entry runs Touch ID in place (no page change; other methods remain on
  failure). With passkey as the ONLY method, submitting the email runs the ceremony directly
  on the login page (auto-fire; "Continue with passkey" appears if the browser blocks it).
- **Fallback page:** `/id/login/passkey?loginName=<you>` still works when visited directly.

The SMTP catcher is a local-only canary + OTP delivery aid. It does **not**
simulate production (prod SMTP is disabled).

## Deprecated lightweight alternative

`acceptance/docker-compose.zitadel.yml` is a bare Zitadel+Postgres stub
(localhost:8080, no seeding, no mail catcher, no same-origin proxy). It is kept
only as a minimal scratch harness; prefer a staging-shaped seeded stack per §1.
(The stub's completion work was dropped when A-H1 was reframed, 2026-07-17.)

> This harness feeds the `test:acceptance` suite later; it stays manual for now.
