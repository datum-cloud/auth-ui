# Account Recovery

A user who cannot use their passkey gets a one-time passkey registration link by email. Opening it, or typing the code from the same mail, lets them register a new passkey on the account. Recovery needs no session, by design: the mailed code is the authorisation. Neither recovery route reads the `sessions` cookie or applies the sudo gate (`app/resources/recovery/recovery-ceremony.ts`).

Routes: `app/routes/recover/index.tsx` (`/recover`) and `app/routes/recover/complete.tsx` (`/recover/complete`). Services: `app/resources/recovery/`.

## Two Ways In

**Self-serve.** The user asks for a link at `/recover`. An optional `?email=` (or `?loginName=`) prefills the address. Entry points link there only while `AUTH_ACCOUNT_RECOVERY_ENABLED` is on:

| Where            | Link                      | Shown when                                                                         |
| ---------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `/login/passkey` | "Can't use your passkey?" | the server has rejected a passkey attempt (`app/routes/login/passkey.tsx`)         |
| `/error`         | "Recover your account"    | the error code is `no_supported_method` (`app/routes/error.tsx`)                   |
| `/signup`        | "Recover your account"    | the address already belongs to an enrolled account (`app/routes/signup/index.tsx`) |
| `/verify`        | "Didn't get the email?"   | always (`app/routes/verify/index.tsx`)                                             |

The `/login/passkey` link reads the action's error, so a ceremony the user cancels in the browser (which never posts) does not show it.

**Support.** Staff use "Send passkey recovery link" on the user page in the staff portal. That request reaches zitadel-provider through milo, not through this app; see the [staff-portal operator guide](https://github.com/datum-cloud/staff-portal/blob/main/docs/operators/passkey-recovery.md). Whichever side issued the code, this app has one completion page, `/recover/complete`, and nothing in it depends on who asked.

## The Request Step

`/recover` posts `intent=request` with the address. The action (`app/routes/recover/index.tsx`) runs the reCAPTCHA v3 gate with action `recovery`, then hands the address to `requestRecovery` in `app/resources/recovery/recovery.service.ts`, which decides in this order:

1. **Per-address rate limit.** `allowResend` (`app/resources/signup/signup-resend-limit.ts`): one mail per address per 5 minutes, at most 5 per day. The budget is shared with signup's verification resend, so the two forms cannot be combined to double the mail rate. It runs first so a refused request does no Zitadel work.
2. **Zitadel lookup.** `findUser` by address, scoped to the requested org.
3. **No auth methods.** An account with zero methods is an unfinished signup. Instead of a recovery link it gets its signup verification mail again, through `resendVerification` (`app/resources/signup/verification-resend.ts`), landing on `/signup/complete?next=passkey`. If Zitadel answers that the address is already verified, the request falls through to a real recovery link.
4. **Org policy.** If the org's login policy has `passkeysType` set to `not_allowed`, nothing is sent.
5. **Delivery.** With `RECOVERY_MAIL_URL` unset, nothing is sent. Otherwise `sendRecoveryMail` (`app/server/infra/recovery-mail.server.ts`) POSTs `{ userId, returnTo, requestedBy: "self" }` over mTLS to `RECOVERY_MAIL_URL`, the `/v1/email/recovery` endpoint on the zitadel-provider authn webhook. The webhook mints the registration code, sends the mail, and answers with the `codeId` only. This app never sees the code.

Every outcome renders the same "Check your email" screen and sets a `recovery_ticket` cookie of the same length. A real ticket seals `{ userId, codeId }`; every other exit sets a filler that opens to nothing (`app/resources/recovery/recovery-ticket.server.ts`). A request the reCAPTCHA gate rejects gets the same screen and a filler. Every exit waits for a shared deadline (`waitUntilDeadline`) so timing does not separate the cases either. Together these keep the response from revealing whether an account exists.

What happened is in the server log instead. Each request writes a `recovery_request` event with `outcome` (`sent`, `resumed_signup`, `suppressed`) and, when suppressed, a `reason`:

| `reason`            | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| `rate_limited`      | the per-address budget is spent                               |
| `unknown_address`   | no user for that address in that org                          |
| `org_policy`        | the org does not allow passkeys                               |
| `delivery_disabled` | `RECOVERY_MAIL_URL` is unset                                  |
| `provider_error`    | a Zitadel call failed; a bounded `code` field names the error |

The mail call logs separately: `recovery_mail_sent` or `recovery_mail_failed`, with the HTTP `status` or an error `reason`. `outcome: sent` on `recovery_request` means the service reached the send; only `recovery_mail_sent` means the webhook accepted it.

## Finishing: Link or Code

The self-serve mail offers two ways to finish; the mail support sends carries only the link.

**The link.** `/recover/complete?userId=…&codeId=…#code=…`. The code sits in the URL fragment, which browsers never send to a server, so it cannot land in an access log or a proxy. The page reads it from `location.hash` into a hidden field and strips it from the address bar with `history.replaceState`. The route also sends `Referrer-Policy: no-referrer`, so the `userId` and `codeId` in the query do not leak through a Referer. The loader makes no Zitadel call: the code is single use, and consuming it on GET would let a mail scanner or link prefetcher burn it. The user presses Continue to start. With no fragment (or no JavaScript), the page asks for the code from the mail.

**The code.** Typed into the "Check your email" screen on the device that made the request (`intent=code`, reCAPTCHA action `recovery_code`). The `userId` and `codeId` come from the `recovery_ticket` cookie, not the form. The ticket is AES-256-GCM sealed under a key derived from `SESSION_SECRET` and bound to a hash of the requested address, so it only opens for that address and only in that browser. Every failure (wrong code, other address, filler ticket, no ticket) gets one answer: "That code is invalid or has expired."

## What Is Validated

Both doors call `startRecoveryCeremony` (`app/resources/recovery/recovery-ceremony.ts`), which calls Zitadel `RegisterPasskey(userId, { codeId, code })`:

- The code belongs to that user and that `codeId`. Changing `userId` or `codeId` in the link fails the call.
- It is single use. A second attempt with the same code fails.
- It expires. The lifetime is Zitadel's `PasswordlessInitCode` expiry, one hour in Datum's setup; the request ticket's TTL (`RECOVERY_TICKET_TTL_MS`) is set to match.

Every one of those failures returns the same generic screen, "This link is invalid or has expired", with a "Request a new link" button (`app/components/recovery-ceremony/recovery-ceremony.tsx`).

On success the route sets a `recovery_ceremony` cookie sealing `{ userId, passkeyId }` (10 minutes) and returns the WebAuthn creation options. `finishRecoveryCeremony` reads identity only from that cookie: the form has no `userId` field, and its `passkeyId` must match the sealed one. That stops a session-less verify endpoint from being pointed at another account.

## After

Recovery does not create a session. On a verified passkey both routes redirect to `/login` with `loginName` prefilled and `notice=passkey-recovered`. `recoveryExitCookies` (in both route modules) expires the two recovery cookies and points the `passkey-hint` cookie at the recovered account, so the `/login` loader arms the user-bound passkey prompt and the user signs in with the new passkey through the normal ceremony. See [Auth Flows](./auth-flows.md#login).

## Sequence

```text
browser            auth-ui                   authn webhook          Zitadel        mail
   |                  |                            |                    |             |
   | POST /recover    |                            |                    |             |
   |----------------->| reCAPTCHA, rate limit      |                    |             |
   |                  |---- findUser, methods, policy ----------------->|             |
   |                  | POST /v1/email/recovery    |                    |             |
   |                  |--------------------------->| mint code          |             |
   |                  |                            |------------------->|             |
   |                  |                            | Email resource ----------------->|
   |                  |<--------- { codeId } ------|                    |             |
   |<-- "Check your email" + recovery_ticket       |                    |             |
   |                  |                            |                    |             |
   | open link (#code) or type the code            |                    |             |
   | POST start/code  |                            |                    |             |
   |----------------->| RegisterPasskey(userId, codeId, code) -------->|             |
   |<-- creation options + recovery_ceremony       |                    |             |
   | WebAuthn create  |                            |                    |             |
   | POST verify      |                            |                    |             |
   |----------------->| VerifyPasskeyRegistration --------------------->|             |
   |<-- 302 /login?notice=passkey-recovered + passkey-hint              |             |
```

## Operations

Two variables, both in [Configuration](../operations/configuration.md#feature-flags):

- `AUTH_ACCOUNT_RECOVERY_ENABLED`: off unless `true` or `1`.
- `RECOVERY_MAIL_URL`: the webhook endpoint. It shares the `VERIFICATION_MAIL_*` client certificate files, and the schema refuses to boot when it is an `https://` URL and those files are not all set.

**Kill switch.** With the flag off, `/recover` and `/recover/complete` return 404 from loader and action, and every entry-point link disappears. Links already mailed stop working at once (their landing page is gone) and expire in Zitadel within the hour. The support side has its own switch in zitadel-provider, `--recovery-links-enabled`. The operator runbook for both webhook halves is [account-recovery.md in zitadel-provider](https://github.com/milo-os/zitadel-provider/blob/main/docs/runbooks/account-recovery.md).

The `/recover` and `/recover/complete` POSTs also count against the per-IP signup limiter in `app/server/middleware/rate-limit.ts`. The per-address bound is `allowResend`, above.

Symptoms and fixes: [Troubleshooting](../operations/troubleshooting.md#a-recovery-request-says-check-your-email-but-no-mail-arrives).
