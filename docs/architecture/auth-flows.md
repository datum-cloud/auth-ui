# Auth Flows

Every ceremony the app implements, with the route modules that back it. URL paths are declared in `app/routes.ts`; the loaders and actions call services in `app/resources/`.

## Login

`app/routes/login/`. `layout.tsx` hoists the shared URL context (auth request, org, login name) that every child reads.

```text
/login            index.tsx      identifier entry; arms a passkey prompt (below)
   |
   +--> /login/passkey-discover   passkey-discover.tsx   usernameless: who tapped? (action only)
   |
   v
/login/method     method.tsx     pick an available auth method
   |
   +--> /login/password       password.tsx       password check
   +--> /login/passkey        passkey.tsx        WebAuthn passkey assertion
   +--> /login/security-key   security-key.tsx   U2F / security key
   +--> /login/mfa            mfa.tsx            second-factor picker
            |
            +--> /login/verify/authenticator   verify/authenticator.tsx   TOTP code
            +--> /login/verify/email           verify/email.tsx           email OTP
            +--> /login/verify/sms             verify/sms.tsx             SMS OTP
```

Services: `app/resources/login/`, `app/resources/mfa/`, `app/resources/otp/`, `app/resources/webauthn/`, `app/resources/session/`.

### Passkey sign-in

`/login/passkey` runs a WebAuthn assertion against a challenge Zitadel issues for the identified user (`app/resources/webauthn/webauthn-verify.ts`). On success it sets the `last-used-login` and `passkey-hint` cookies. Once the server has rejected an attempt, and only while `AUTH_ACCOUNT_RECOVERY_ENABLED` is on, the screen offers "Can't use your passkey?", which opens [Account Recovery](./account-recovery.md) with the address prefilled.

### The passkey hint and the arming cascade

`passkey-hint` (`app/modules/auth/session/passkey-hint.ts`) holds the loginName of the last account that signed in on this browser: signed with `SESSION_SECRET`, `httpOnly`, scoped to `/id`, 7 days. It is never an auth signal and never rendered. Successful password, passkey, email OTP and SSO sign-ins write it, as do an account switch on `/accounts` and account recovery. Signup completion writes it and `/signup/success` clears it again, because the signup session cannot arm a passkey challenge. Logout clears it when it names the account signing out, and `/login` clears it when the named user no longer resolves.

The `/login` loader uses it to arm a passkey prompt before the user types anything. `armLoginPasskey` (`app/resources/webauthn/arm-login-passkey.ts`) tries two arms in order:

1. **User-bound.** Taken when there is a hint, the request is not `?add=1`, the hinted account has no live session in this browser, and the account has a passkey. The loader creates a Zitadel session with a passkey challenge for that user and offers it through conditional mediation.
2. **Discovery.** Taken when the user-bound arm was skipped and `AUTH_PASSKEY_DISCOVERY_ENABLED` is on (the default). The challenge is self-minted (`app/resources/webauthn/identity-challenge.ts`): no Zitadel call, nothing stored.

If neither arms, the page renders as a plain identifier form.

### Usernameless discovery

When the user taps a passkey offered by the discovery arm, the browser posts that first assertion to `/login/passkey-discover` (`app/routes/login/passkey-discover.tsx`). Its signature is never checked; the action reads only `userHandle` (the Zitadel user id), resolves the user, and arms a user-bound challenge for them. The second assertion, against that challenge, authenticates the user; Zitadel verifies it through the `/login/passkey` action. Every user-dependent failure returns one opaque 400 so the endpoint reveals no more than the identifier form does; the `passkey_discover` audit event carries the real reason. A user who is already signed in gets a 409. With `AUTH_PASSKEY_DISCOVERY_ENABLED=false` the loader stops offering discovery and the action refuses.

### Email OTP is not a sign-in method

`EMAIL_OTP_SIGNIN_ENABLED` in `app/resources/login/email-otp-signin.ts` is `false`, so `otp_email` is never offered as a way to sign in, even when `AUTH_EMAIL_DELIVERY_ENABLED` is on. Every reader goes through `isEmailOtpSignInUsable`: the `/login` email-link button (`login-view.ts`), the `/login/method` chooser (`method-options.ts`), post-identifier routing (`login-decision.ts`), and the `intent=email-link` branch of the `/login` action. `/login/verify/email` and `app/resources/otp/` still exist for re-enabling it.

Two consequences:

- An account whose only method is `otp_email` (a verified signup that never enrolled a passkey) has nothing to sign in with, and `/login` sends it to `/error?code=no_supported_method`. That error screen offers account recovery when the flag is on.
- The last-method guard does not count `otp_email` as a backup. `removeUserPasskey` in `app/resources/passkeys/passkeys.service.ts` filters enrolled methods through `usableSignInMethods` (`app/resources/shared/usable-methods.ts`) and refuses to remove the last active passkey when no other usable method remains.

## Signup

`app/routes/signup/`. Signup is passkey-only and always verifies the address before the account can sign in. `/signup` is the one entry:

```text
/signup             index.tsx      address -> register user, send verification mail
   |                               "Check your email": click the link, or type the code here
   v
/signup/complete    complete.tsx   verify address, enrol otp_email, create session
   |
   v
/setup/passkey      (enrolment)    register the passkey (skippable)
   |
   v
/signup/success     success.tsx    terminal screen
```

- **reCAPTCHA v3.** The `/signup` action calls `recaptchaRejects` (`app/server/infra/recaptcha.server.ts`) before any Zitadel work, with action `signup` for the address and `signup_code` for a typed code. The page loads the widget with `RECAPTCHA_SITE_KEY`; verification needs `RECAPTCHA_SECRET_KEY` too. With the keys unset the gate passes everything, and an unreachable Google fails open.
- **Register.** `registerPasskeySignup` (`app/resources/signup/passkey-signup.ts`) re-reads the org policy (refuses when registration or passkeys are not allowed) and refuses when `AUTH_EMAIL_DELIVERY_ENABLED` is off, since nobody could finish. It then calls `registerEmailLinkSignup` in `app/resources/signup/signup.service.ts`, which creates the Zitadel user through `AddHumanUser`. That call kicks off [user provisioning](./user-provisioning.md). The name is a placeholder derived from the address (`placeholder-name.ts`).
- **Verification mail.** With `VERIFICATION_MAIL_URL` set, the user is created with `returnCode`, and `sendVerificationMail` (`app/server/infra/verification-mail.server.ts`) POSTs the code over mTLS to the zitadel-provider webhook, which mails a link to `/signup/complete?…&next=passkey`. With it unset, Zitadel sends its own mail to the same landing page. A failed send never changes the response.
- **Finish.** `/signup/complete` (link) and the typed code on `/signup` both go through `completeSignupHandoff` (`app/resources/signup/complete-handoff.ts`): verify the address, enrol `otp_email`, create the session, set `sessions`, `last-used-login` and `passkey-hint`, then redirect to `/setup/passkey` with `returnTo=/signup/success`.
- **Resend.** There is no resend button. Submitting the same address again on `/signup` for an account with no auth methods resends the verification mail (`resendIfSquatted` and `verification-resend.ts`), limited per address to one mail per 5 minutes and 5 per day (`signup-resend-limit.ts`, a budget shared with account recovery).
- **Enumeration.** A fresh address and an unfinished one get the same "Check your email" screen, padded to the same deadline. An address that belongs to an account with methods gets an explicit "already exists" error, by product decision, plus the recovery link when the flag is on.

`/signup/method` is still live as a second entry into the same `registerPasskeySignup` path (behind its own reCAPTCHA gate) so an open tab does not break, but `/signup` no longer routes there. `/signup/password` is retired: its loader redirects to `/signup` and its action answers 400.

## SSO

`app/routes/sso/`: `index.tsx` (provider selection / IdP start), `link.tsx` (link an IdP identity to an existing account), `ldap.tsx` (LDAP credential entry), and `provider/callback.tsx` + `provider/error.tsx` for the `/sso/:provider/callback` and `/sso/:provider/error` return legs.

The SAML POST binding is rendered by Hono at `/id/sso/saml-post` (`app/server/routes/saml-post.ts`), outside React Router.

Services: `app/resources/sso/`: IdP start, callback handling, identity linking, auto-create on first login, LDAP, and return-URL validation.

## MFA / OTP Setup

`app/routes/setup/`: enrollment screens reached after login when a factor is required or offered:

| Route                  | Module                               | Factor                          |
| ---------------------- | ------------------------------------ | ------------------------------- |
| `/setup/mfa`           | `app/routes/setup/mfa.tsx`           | picker across available factors |
| `/setup/authenticator` | `app/routes/setup/authenticator.tsx` | TOTP authenticator app          |
| `/setup/passkey`       | `app/routes/setup/passkey.tsx`       | WebAuthn passkey                |
| `/setup/security-key`  | `app/routes/setup/security-key.tsx`  | U2F security key                |
| `/setup/email`         | `app/routes/setup/email.tsx`         | email OTP                       |
| `/setup/sms`           | `app/routes/setup/sms.tsx`           | SMS OTP                         |

## Passkeys

| Route            | Module                         | Purpose                                      |
| ---------------- | ------------------------------ | -------------------------------------------- |
| `/passkeys`      | `app/routes/passkeys.tsx`      | list, add and remove the account's passkeys  |
| `/setup/passkey` | `app/routes/setup/passkey.tsx` | enrol a passkey                              |
| `/reauth`        | `app/routes/reauth.tsx`        | "Confirm it's you" before a sensitive change |

- **Management.** `/passkeys` (`app/resources/passkeys/passkeys.service.ts`) needs a live session. Removal is sudo-gated and protected by the last-method guard described under [Login](#email-otp-is-not-a-sign-in-method). After a removal the page offers to sign out other sessions, and it shows a banner when only one sign-in method is left. Add goes to `/setup/passkey` with a return to `/passkeys`.
- **Enrolment.** `/setup/passkey` uses the shared enrolment factory in `app/resources/webauthn/webauthn-enroll.ts`: the WebAuthn ceremony, then a name step. Adding a passkey is sudo-gated; a stale session is sent to `/reauth` first. Signup reaches this route with a fresh session and a `returnTo` of `/signup/success`.
- **Re-authentication.** `/reauth` verifies one enrolled factor onto the existing session and returns to a validated `returnTo` (default `/passkeys`). The sudo window is 10 minutes (`SUDO_TTL_MS` in `app/resources/shared/sudo.ts`). IdP re-authentication returns through `/reauth/:provider/callback` and `/reauth/:provider/error`. Services: `app/resources/reauth/`.

## Account Recovery

`/recover` and `/recover/complete`: a user who cannot use their passkey requests a one-time passkey registration link by email and registers a new passkey without a session. See [Account Recovery](./account-recovery.md). Services: `app/resources/recovery/`.

## Password

`app/routes/password/`: `reset.tsx` (request a reset), `new.tsx` (set a password from a reset link), `change.tsx` (change a password while signed in). Backed by `app/resources/password/`.

## Email Verification

`app/routes/verify/`, backed by `app/resources/verify/`. Signup verification lands on `/signup/complete`, not here; `/verify` serves the other verification mails, which link to `/verify?code=…&userId=…`.

- `/verify` (`index.tsx`) prefills the code from the link. Its loader with `?send=true`, and its `intent=resend` action, send a new code only when the active session owns `userId` (`dispatchEmailCode` and `resendEmailCode` in `verify.service.ts`). A valid code redirects to `/authorize` when there is an auth request, to `/signed-in` when there is an active session, and to `/verify/success` otherwise. With `AUTH_ACCOUNT_RECOVERY_ENABLED` on, the page also links "Didn't get the email?" to `/recover`.
- `/verify/success` (`success.tsx`) confirms the address and links back to `/login`.

## Device Authorization

`app/routes/device/`: `index.tsx` (user-code entry), then `authorize.tsx` (consent: authorize or deny), then `complete.tsx` (terminal screen). `complete.tsx` deliberately has **no** device-auth loader, so React Router's post-action revalidation never tries to re-resolve a device-auth request that has legitimately been consumed. Backed by `app/resources/device/`.

## Logout

`app/routes/logout/`: `index.tsx` and `success.tsx`. The post-logout redirect target is validated against `POST_LOGOUT_ALLOWLIST` in `app/resources/session/session-logout.service.ts`: a relative path is fine, an absolute URL is followed **only** if its origin is on the allowlist. Anything else falls back to the in-app success screen.

## Accounts

`app/routes/accounts.tsx`: the multi-session account switcher. List signed-in sessions, pick one, remove one, and manage linked IdP identities. Reads and writes the `sessions` cookie via `app/modules/auth/session/cookie.ts` and delegates to `app/resources/session/`.

## Supporting Routes

| Route        | Module                           | Purpose                       |
| ------------ | -------------------------------- | ----------------------------- |
| `/`          | `app/routes/_index.tsx`          | entry redirect                |
| `/authorize` | `app/routes/authorize/index.tsx` | OIDC auth-request entry point |
| `/signed-in` | `app/routes/signed-in.tsx`       | post-auth landing / hand-off  |
| `/error`     | `app/routes/error.tsx`           | neutral error screen          |
| `*`          | `app/routes/catchall.tsx`        | 404                           |
