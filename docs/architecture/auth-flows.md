# Auth Flows

Every ceremony the app implements, with the route modules that back it. URL paths are declared in `app/routes.ts`; the loaders and actions call services in `app/resources/`.

## Login

`app/routes/login/` — `layout.tsx` hoists the shared URL context (auth request, org, login name) that every child reads.

```text
/login            index.tsx      identifier entry
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

## Signup

`app/routes/signup/` — `layout.tsx` plus `index.tsx` (identifier) → `method.tsx` (password or IdP) → `password.tsx` (set a password) → `complete.tsx` (terminal screen).

Password signup calls `app/resources/signup/signup.service.ts`, which creates the Zitadel user via `AddHumanUser`. That single call is what kicks off [user provisioning](./user-provisioning.md).

## SSO

`app/routes/sso/` — `index.tsx` (provider selection / IdP start), `link.tsx` (link an IdP identity to an existing account), `ldap.tsx` (LDAP credential entry), and `provider/callback.tsx` + `provider/error.tsx` for the `/sso/:provider/callback` and `/sso/:provider/error` return legs.

The SAML POST binding is rendered by Hono at `/id/sso/saml-post` (`app/server/routes/saml-post.ts`), outside React Router.

Services: `app/resources/sso/` — IdP start, callback handling, identity linking, auto-create on first login, LDAP, and return-URL validation.

## MFA / OTP Setup

`app/routes/setup/` — enrollment screens reached after login when a factor is required or offered:

| Route                  | Module                               | Factor                          |
| ---------------------- | ------------------------------------ | ------------------------------- |
| `/setup/mfa`           | `app/routes/setup/mfa.tsx`           | picker across available factors |
| `/setup/authenticator` | `app/routes/setup/authenticator.tsx` | TOTP authenticator app          |
| `/setup/passkey`       | `app/routes/setup/passkey.tsx`       | WebAuthn passkey                |
| `/setup/security-key`  | `app/routes/setup/security-key.tsx`  | U2F security key                |
| `/setup/email`         | `app/routes/setup/email.tsx`         | email OTP                       |
| `/setup/sms`           | `app/routes/setup/sms.tsx`           | SMS OTP                         |

## Password

`app/routes/password/` — `reset.tsx` (request a reset), `new.tsx` (set a password from a reset link), `change.tsx` (change a password while signed in). Backed by `app/resources/password/`.

## Email Verification

`app/routes/verify/` — `index.tsx` (submit or resend a verification code) and `success.tsx`. Backed by `app/resources/verify/`.

## Device Authorization

`app/routes/device/` — `index.tsx` (user-code entry) → `authorize.tsx` (consent: authorize or deny) → `complete.tsx` (terminal screen). `complete.tsx` deliberately has **no** device-auth loader, so React Router's post-action revalidation never tries to re-resolve a device-auth request that has legitimately been consumed. Backed by `app/resources/device/`.

## Logout

`app/routes/logout/` — `index.tsx` and `success.tsx`. The post-logout redirect target is validated against `POST_LOGOUT_ALLOWLIST` in `app/resources/session/session-logout.service.ts`: a relative path is fine, an absolute URL is followed **only** if its origin is on the allowlist. Anything else falls back to the in-app success screen.

## Accounts

`app/routes/accounts.tsx` — the multi-session account switcher: list signed-in sessions, pick one, remove one, and manage linked IdP identities. Reads and writes the `sessions` cookie via `app/modules/auth/session/cookie.ts` and delegates to `app/resources/session/`.

## Supporting Routes

| Route        | Module                           | Purpose                       |
| ------------ | -------------------------------- | ----------------------------- |
| `/`          | `app/routes/_index.tsx`          | entry redirect                |
| `/authorize` | `app/routes/authorize/index.tsx` | OIDC auth-request entry point |
| `/signed-in` | `app/routes/signed-in.tsx`       | post-auth landing / hand-off  |
| `/error`     | `app/routes/error.tsx`           | neutral error screen          |
| `*`          | `app/routes/catchall.tsx`        | 404                           |
