# Troubleshooting

Production symptoms and what actually causes them. For local development failures, see
[Debugging](../guides/debugging.md).

## The app crash-loops on boot

**Cause:** environment validation. The Zod schema in `app/server/infra/env.server.ts` is parsed at
module load, so bad config aborts the process before it serves a single request. That is
deliberate — the alternative is mailing users verification links pointing at a placeholder domain.

The usual culprits, in order:

| Message | Fix |
| --- | --- |
| `SESSION_SECRET must be at least 32 characters` | Longer secret. `openssl rand -base64 32`. |
| `ZITADEL_API_URL must be set in production` | Set it, or set `AUTH_PROVIDER=fake` if this is a fake-provider run. |
| `ZITADEL_SERVICE_USER_TOKEN must be set in production` | Provision the service-user PAT in the `auth-ui` Secret. |
| `PUBLIC_ORIGIN must be set in production` | Set the real public origin. |
| `PUBLIC_ORIGIN is still the deployment placeholder` | `config/base/deployment.yaml` ships `https://REPLACE_ME.example`. Someone skipped the cutover step. |
| `SENTRY_DSN must be an https:// URL` | Fix or unset the DSN. Unset is a valid state — Sentry is a no-op. |

```bash
kubectl -n auth-ui logs -l app.kubernetes.io/name=auth-ui --tail=100
```

The first line of the crash is the Zod issue. See [Configuration](./configuration.md).

## Logins redirect to a 404

**Cause:** base-path mismatch. The app is served at `/id`, and three layers must agree — Vite's
`base: '/id/'`, the Hono asset mounts, and the `HTTPRoute` path prefix. But the layer that usually
drifts is the fourth one, outside this repo: **Zitadel's login-v2 base URI**. Zitadel appends
`/login?authRequest=…` (OIDC) or `?samlRequest=…` (SAML) to whatever base URI it is configured
with, so if that base URI is missing the `/id` prefix, every login begins with a 404.

Check the Zitadel instance's login-v2 URL setting before touching anything in this repo.

Requests to the legacy `/ui/v2/login/*` paths are 301'd to `/id/*` by the `legacyRedirects`
middleware — see [ADR 003](../architecture/adrs/003-legacy-ui-v2-redirects.md). If a sibling repo
still hardcodes those links they will work, but the redirect hop is a hint that the caller is out
of date.

## Signup shows "Registration is currently unavailable"

**Not an app bug.** The signup view gates on `allowRegister` from Zitadel's login settings for the
resolved organization (`app/resources/signup/signup-view.ts`). If registration is disabled in the
Zitadel org policy, the UI correctly refuses to offer a flow that would fail.

Two ways to reach that message:

- `allowRegister` is false on the org policy → fix it in Zitadel, not here
- `allowRegister` is true, but there are no IdP buttons **and** email entry is disabled → the org
  has no usable signup method configured

Note the org matters: with org-first scoping, the settings come from the resolved org, which may
be `ZITADEL_DEFAULT_ORG_ID` or the instance default. See
[ADR 005](../architecture/adrs/005-login-org-scoping.md).

## Users sign up but never appear in the staff portal

**Cause:** provisioning, not authentication. The user exists in Zitadel — the sign-up genuinely
worked — but the downstream Datum user record was never created. This app creates users via
`AddHumanUser`, which emits `user.human.added`; the provisioning pipeline consumes that event.

Read [User Provisioning](../architecture/user-provisioning.md) for the event contract, and
[ADR 006](../architecture/adrs/006-signup-provisioning-invariant.md) for the invariant that keeps
the two in step. Debugging this from the auth-ui side is almost always the wrong end of the
problem.

## Post-logout redirect is rejected

**Cause:** `POST_LOGOUT_ALLOWLIST`. The OIDC RP-initiated logout `post_logout_redirect` target is
checked against a fail-closed allowlist of absolute origins. Unset means **only same-origin
relative paths are permitted** — an absolute URL to a portal on another origin will be rejected.

Add the origin (comma-separated, e.g. `https://portal.example.com`) to `POST_LOGOUT_ALLOWLIST`.
This is an open-redirect guard, so the failure mode is deliberate: it fails closed rather than
forwarding a signed-out user to an attacker-supplied URL.

## Nothing appears in Sentry

Expected when `SENTRY_DSN` is unset — Sentry is a true no-op at boot. If the DSN *is* set and
events still look empty, remember the scrubber is an allowlist
(`app/server/sentry-scrub.ts`): events arrive stripped of provider detail and PII by design. Pivot
to the server log using the `traceId` tag, which survives scrubbing. See
[Observability](./observability.md).
