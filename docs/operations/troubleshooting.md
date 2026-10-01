# Troubleshooting

Production symptoms and what actually causes them. For local development failures, see
[Debugging](../guides/debugging.md).

## The app crash-loops on boot

**Cause:** environment validation. The Zod schema in `app/server/infra/env.server.ts` is parsed at
module load, so bad config aborts the process before it serves a single request. That is
deliberate: the alternative is mailing users verification links pointing at a placeholder domain.

The usual culprits, in order:

| Message                                                                                           | Fix                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET must be at least 32 characters`                                                   | Longer secret. `openssl rand -base64 32`.                                                               |
| `ZITADEL_API_URL must be set in production`                                                       | Set it, or set `AUTH_PROVIDER=fake` if this is a fake-provider run.                                     |
| `ZITADEL_SERVICE_USER_TOKEN must be set in production`                                            | Provision the service-user PAT in the `auth-ui` Secret.                                                 |
| `PUBLIC_ORIGIN must be set in production`                                                         | Set the real public origin.                                                                             |
| `PUBLIC_ORIGIN is still the deployment placeholder`                                               | `config/base/deployment.yaml` ships `https://REPLACE_ME.example`. Someone skipped the cutover step.     |
| `SENTRY_DSN must be an https:// URL`                                                              | Fix or unset the DSN. Unset is a valid state: Sentry is a no-op.                                        |
| `VERIFICATION_MAIL_URL is set to an https URL but VERIFICATION_MAIL_CLIENT_CERT_FILE / ...`       | Mount the client cert, key and CA and set all three `VERIFICATION_MAIL_*_FILE` paths, or unset the URL. |
| `RECOVERY_MAIL_URL is set to an https URL but the VERIFICATION_MAIL_* client cert files are not.` | Same three files; recovery shares them.                                                                 |
| `RECAPTCHA_SITE_KEY is set but RECAPTCHA_SECRET_KEY is not`                                       | Set the secret, or unset the site key.                                                                  |
| `RECAPTCHA_SECRET_KEY is set but PUBLIC_ORIGIN is not`                                            | Set `PUBLIC_ORIGIN`.                                                                                    |

```bash
kubectl -n auth-ui logs -l app.kubernetes.io/name=auth-ui --tail=100
```

The first line of the crash is the Zod issue. See [Configuration](./configuration.md).

## Logins redirect to a 404

**Cause:** base-path mismatch. The app is served at `/id`, and three layers must agree: Vite's
`base: '/id/'`, the Hono asset mounts, and the `HTTPRoute` path prefix. But the layer that usually
drifts is the fourth one, outside this repo: **Zitadel's login-v2 base URI**. Zitadel appends
`/login?authRequest=…` (OIDC) or `?samlRequest=…` (SAML) to whatever base URI it is configured
with, so if that base URI is missing the `/id` prefix, every login begins with a 404.

Check the Zitadel instance's login-v2 URL setting before touching anything in this repo.

Requests to the legacy `/ui/v2/login/*` paths are 301'd to `/id/*` by the `legacyRedirects`
middleware; see [ADR 003](../architecture/adrs/003-legacy-ui-v2-redirects.md). If a sibling repo
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

**Cause:** provisioning, not authentication. The user exists in Zitadel (the sign-up genuinely
worked), but the downstream Datum user record was never created. This app creates users via
`AddHumanUser`, which emits `user.human.added`; the provisioning pipeline consumes that event.

Read [User Provisioning](../architecture/user-provisioning.md) for the event contract, and
[ADR 006](../architecture/adrs/006-signup-provisioning-invariant.md) for the invariant that keeps
the two in step. Debugging this from the auth-ui side is almost always the wrong end of the
problem.

## A recovery request says "Check your email" but no mail arrives

**Expected screen, by design.** `/recover` answers every request with the same "Check your email"
screen, whether or not a mail went out, so only the server log tells you what happened. Every
request writes one `recovery_request` auth event, and a suppressed one carries a `reason`
(`app/resources/recovery/recovery.service.ts`):

```bash
kubectl -n auth-ui logs -l app.kubernetes.io/name=auth-ui --since=1h \
  | grep '"event":"recovery_'
```

| You see                                      | Cause                                                                                                                                                    | Fix                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `reason: delivery_disabled`                  | `RECOVERY_MAIL_URL` is unset                                                                                                                             | Set it to the webhook's `/v1/email/recovery` endpoint.                                   |
| `reason: rate_limited`                       | the address used its budget: one mail per 5 minutes, 5 per day, shared with signup's verification resend (`app/resources/signup/signup-resend-limit.ts`) | Wait. The counters are in memory, per replica.                                           |
| `reason: unknown_address`                    | no user for that address in the resolved org                                                                                                             | Check the address and the `?organization=` the user came in with.                        |
| `reason: org_policy`                         | the org's login policy does not allow passkeys                                                                                                           | Fix the policy in Zitadel.                                                               |
| `reason: provider_error`                     | a Zitadel call failed; `code` names it                                                                                                                   | Look for the Zitadel fault.                                                              |
| `outcome: resumed_signup`                    | the account has no auth methods, so it got its signup verification mail instead                                                                          | Expected. The user finishes signup from that mail.                                       |
| `outcome: sent`, then `recovery_mail_failed` | the webhook call failed: `status` is the HTTP status, `reason` the error name when there was no response                                                 | See below.                                                                               |
| `outcome: sent`, then `recovery_mail_sent`   | the webhook accepted it                                                                                                                                  | The problem is downstream of auth-ui: the webhook's Email resource or the mail provider. |

When the webhook call fails:

- **No `status`, only a `reason`.** The connection or the TLS handshake failed. Check that the
  URL is `https://` (a plain `http://` URL sends no client certificate) and that the three
  `VERIFICATION_MAIL_*_FILE` paths point at a readable, unexpired client certificate, key and CA.
  The files are read per request, so a fixed Secret takes effect without a restart.
- **Client name not allowed.** The webhook accepts only client certificates named in its
  `--mail-webhook-allowed-client-names` list. Its log records the `caller=` it resolved for each
  request.
- **No recovery route on the webhook.** An unset recovery template, or a recovery client that
  failed to build, leaves `/v1/email/recovery` unregistered. The webhook logs the cause at startup.
- **`status: 429`.** The webhook's own per-user cooldown refused the mail. It is separate from
  auth-ui's per-address limit.

The webhook side is covered in the zitadel-provider
[account recovery runbook](https://github.com/milo-os/zitadel-provider/blob/main/docs/runbooks/account-recovery.md).
See also [Account Recovery](../architecture/account-recovery.md).

## A recovery link says it is invalid or expired

**Cause:** Zitadel refused the registration code. Every refusal gets the same screen, "This link
is invalid or has expired" (or, for a typed code, "That code is invalid or has expired"), so the
user cannot tell them apart. The possibilities:

- **Already used.** The code is single use. Pressing Continue consumes it, so going back, or
  opening the link again, fails. A mail scanner that only fetches the link does not burn it,
  because the page load makes no Zitadel call.
- **Expired.** The code lives as long as Zitadel's `PasswordlessInitCode` expiry, one hour in
  Datum's setup.
- **Edited link.** `userId` and `codeId` in the query must match the code in the fragment. A
  changed or truncated link fails.
- **Typed code, wrong address or browser.** A code typed on the "Check your email" screen is
  checked against the `recovery_ticket` cookie set when the link was requested. It only opens for
  the address entered at that time, and only in the browser that asked. A different address, a
  different browser, or a cleared cookie gives "That code is invalid or has expired".
- **Recovery switched off.** With `AUTH_ACCOUNT_RECOVERY_ENABLED` off, both routes return 404
  instead.

The `recovery_complete` auth event carries `path` (`link` or `code`), `stage`, and the provider
error `code`. The fix for the user is always the same: request a new link.

## Post-logout redirect is rejected

**Cause:** `POST_LOGOUT_ALLOWLIST`. The OIDC RP-initiated logout `post_logout_redirect` target is
checked against a fail-closed allowlist of absolute origins. Unset means **only same-origin
relative paths are permitted**: an absolute URL to a portal on another origin will be rejected.

Add the origin (comma-separated, e.g. `https://portal.example.com`) to `POST_LOGOUT_ALLOWLIST`.
This is an open-redirect guard, so the failure mode is deliberate: it fails closed rather than
forwarding a signed-out user to an attacker-supplied URL.

## Nothing appears in Sentry

Expected when `SENTRY_DSN` is unset: Sentry is a true no-op at boot. If the DSN _is_ set and
events still look empty, remember the scrubber is an allowlist
(`app/server/sentry-scrub.ts`): events arrive stripped of provider detail and PII by design. Pivot
to the server log using the `traceId` tag, which survives scrubbing. See
[Observability](./observability.md).
