# Audit fix status

31 of 32 confirmed findings fully fixed on branch fix/auth-ui-audit-fixes; 1 (#16) partially fixed with a documented residual (owner decision 2026-07-04 to defer the full fix). Full finding detail below.

## Verification of cd0a8f707 (the 12 "remaining" findings)

The 12 findings applied in cd0a8f707 were independently re-verified (one verifier + one adversary agent per finding, 2026-07-04). 9 closed cleanly; 3 needed follow-up:

- **CLOSES (9):** #9, #11, #15, #17, #20, #21, #27, #28, #29.
- **#10 [HIGH] — was INCOMPLETE → re-fixed in `bc5632437`.** The cd0a8f707 fix converted the GET auto-grant into a CSRF POST but rendered an *auto-submitting* form (`form.requestSubmit()`). The CSRF token is an unbound double-submit minted first-party on the victim's own page render, and the sessions cookie is SameSite=lax, so the same-site auto-POST always self-validates — the emailed-link consent bypass still completed. Now `resolveSignedIn` hands a `device_` requestId back to the real `/device/authorize` consent screen (explicit Approve showing app + scope); nothing is authorized from the GET loader.
- **#30 [MED] — was REGRESSION → fixed in `67362e91b`.** The committed resend ownership gate broke a green test because the cy.task harness never threaded a session into `resendEmailCode`. Harness + test fixed; ownership-gate coverage (foreign userId, no session → INVALID_INPUT) added.
- **#16 [MED] — PARTIAL.** The cd0a8f707 fix emits a `Set-Cookie` on both the new-email and duplicate-email "check your email" responses, closing the crude *presence* oracle. RESIDUAL: the `sessions` cookie is **signed, not encrypted** (`app/modules/auth/session/cookie.ts`), so a scripted attacker can base64-decode / measure the `Set-Cookie` to distinguish a fresh email (real session cookie, ~300 B) from an existing one (empty `[]`, ~50 B). Full closure requires **encrypting the sessions cookie** (or deferring session creation to the email-verify step so both paths emit an empty cookie). Deferred to a dedicated follow-up per owner decision (2026-07-04).

## Fixed

- [x] app/modules/auth/providers/zitadel/mappers.ts:227  (d7f54581)
- [x] app/server/middleware/rate-limit.ts:117  (d7f54581)
- [x] app/resources/login/login.service.ts:95  (750138607)
- [x] app/routes/signup/method.tsx:82  (2c1f270b)
- [x] app/routes/signup/complete.tsx:38  (0e0e0401)
- [x] app/resources/sso/sso-link.ts:81  (d7f54581)
- [x] app/resources/sso/sso-ldap.ts:78  (0e0e0401)
- [x] app/modules/auth/providers/zitadel/mappers.ts:85  (d7f54581)
- [x] app/modules/auth/session/cookie.ts:92  (d7f54581)
- [x] app/routes/setup/authenticator.tsx:47  (ac96c6f0)
- [x] app/routes/login/index.tsx:107  (750138607)
- [x] app/routes/signup/method.tsx:92  (2c1f270b)
- [x] app/routes/signup/complete.tsx:48  (0e0e0401)
- [x] app/resources/sso/sso-action.ts:79  (d7f54581)
- [x] app/modules/auth/providers/zitadel/mappers.ts:343  (d7f54581)
- [x] app/resources/otp/otp.service.ts:215  (2c1f270b)
- [x] app/resources/webauthn/webauthn.service.ts:200  (2c1f270b)
- [x] app/resources/verify/verify.service.ts:192  (a74089ac)
- [x] app/resources/password/password.service.ts:74  (2c1f270b)
- [x] app/resources/webauthn/webauthn-enroll.ts:153  (ac96c6f0)
- [x] app/resources/verify/verify.service.ts:132  (cd0a8f707)
- [x] app/resources/session/session.service.ts:111  (bc5632437 — cd0a8f707 fix was INCOMPLETE, re-fixed; see Verification)
- [x] app/server.ts:102  (cd0a8f707)
- [x] app/resources/login/login.service.ts:266  (cd0a8f707)
- [~] app/routes/signup/method.tsx:128  (cd0a8f707 — PARTIAL: presence oracle closed; signed-cookie content/size residual, see #16)
- [x] app/routes/signup/method.tsx:116  (cd0a8f707)
- [x] app/resources/sso/sso-callback.ts:251  (cd0a8f707)
- [x] app/resources/sso/sso-callback.ts:296  (cd0a8f707)
- [x] app/components/webauthn-button/webauthn-button.tsx:93  (cd0a8f707)
- [x] app/resources/shared/resolve-org.ts:28  (cd0a8f707)
- [x] app/modules/fraud/maxmind-tracker.tsx:63  (cd0a8f707)
- [x] app/routes/verify/index.tsx:101  (cd0a8f707 + 67362e91b — #30 test regression fixed)

---
# Auth-UI Audit — Confirmed Bugs

Fable-5 ultracode audit, 3-lens adversarial verification. 32 confirmed findings.

## 0. [CRITICAL] toSession maps factors.u2f from a proto field that does not exist — U2F second-factor login loops forever on real Zitadel
**File:** `app/modules/auth/providers/zitadel/mappers.ts:227`  | votes 3/3 | incorrect-api-usage

**Defect:** zitadel.session.v2.Factors has exactly 7 fields (user, password, webAuthN, intent, totp, otpSms, otpEmail) — verified in node_modules/@zitadel/proto/types/zitadel/session/v2/session_pb.d.ts. There is NO u2f field. toSession reads proto.factors?.u2f (lines 180, 227-230), so Session.factors.u2f.verifiedAt is ALWAYS null on live Zitadel. Real Zitadel reports a completed U2F check via the webAuthN factor with userVerified=false, which toSession maps only onto factors.passkey. Downstream, secondFactorFresh (app/resources/shared/lifetimes.ts:28) checks totp/otpEmail/otpSms/u2f — never passkey — and passwordlessPasskeyFresh requires userVerified=true. So a verified U2F check satisfies neither rule. The FakeAuthProvider masks this: its updateSession webAuthN branch sets passkey {verifiedAt, userVerified: true}, so mirrored tests route through the passwordless-passkey rule and pass.

**Failure scenario:** User with password + U2F security key enrolled logs in on live Zitadel: password OK → nextMfaStep step 3 routes to /login/security-key → user completes the U2F ceremony → verifyWebAuthnAssertion succeeds and calls nextStepFromSession → factors.u2f is null and passkey.userVerified is false, so steps 1-2 fail and step 3 sees enrolled ['u2f'] → redirects back to /login/security-key. Infinite loop; every U2F-only-MFA user is unable to sign in.

**Suggested fix:** In toSession, derive the neutral u2f factor from the webAuthN proto factor when userVerified is false (and passkey when true), mirroring Zitadel's own login-app semantics: e.g. const wa = proto.factors?.webAuthN; passkey = wa?.userVerified ? {verifiedAt: v(wa), userVerified: true} : {verifiedAt: null}; u2f = wa && !wa.userVerified ? {verifiedAt: v(wa), userVerified: false} : {verifiedAt: null}. Remove the dead proto.factors?.u2f reads and align the fake's webAuthN branch (see separate finding).

---

## 1. [CRITICAL] Auth rate limiters silently bypassed for all JS/hydrated users because single-fetch actions POST to `<path>.data`
**File:** `app/server/middleware/rate-limit.ts:117`  | votes 3/3 | security-authn-ratelimit-bypass

**Defect:** Every exact-match rate limiter self-guards on the plain route path, e.g. loginPasswordRateLimit uses `match: pathname === '/id/login/password'` (line 117). But this is a React Router v7 (7.18) framework app with single fetch ON by default, so once the page is HYDRATED (the normal production case) a `<Form method="post">` submits to the single-fetch endpoint `<path>.data` — `/id/login/password.data` — not `/id/login/password`. The app's own e2e test confirms this (cypress/e2e/login-hydrated-submit.cy.ts: "A HYDRATED React Router <Form> submits via single-fetch (POST /id/login.data ...)"). `normalizedPathname` in app/server/net.ts (lines 29-31) only lowercases and strips trailing slashes; it does NOT strip the `.data` suffix, so the normalized path is `/id/login/password.data`, which never equals `/id/login/password`. The Hono mount `/id/login/*` still fires (wildcard matches `password.data`), so the middleware runs, but `match()` returns false and it calls `next()` without counting the attempt. I verified against the real single-fetch paths that this defeats loginPasswordRateLimit, signupRateLimit (both `/id/signup` and `/id/signup/password`), passwordResetRateLimit, ldapRateLimit, webauthnVerifyRateLimit, accountsRateLimit, and verifyEmailSendRateLimit. Only the two `startsWith(...)` guards (mfaVerify `/id/login/verify/`, mfaEnroll `/id/setup/`) survive because the prefix still matches. The Cypress rate-limit tests never caught this: they call `limiter.check` directly, and all other specs run with hydration OFF (skipHydration), so their native POSTs hit the plain `/id/login/password` path that DOES match.

**Failure scenario:** An attacker performs password brute-force / credential stuffing against victim@acme.com. Using an ordinary JS-enabled browser (or a script that targets the single-fetch endpoint), each guess POSTs to `/id/login/password.data` with body `loginName=victim@acme.com&password=<guess>&csrf=<token>`. Hono's `/id/login/*` mount matches, createRateLimit computes normalizedPathname `/id/login/password.data`, the self-guard `pathname === '/id/login/password'` returns false, so no counter is incremented and `verifyLoginPassword` calls Zitadel for every attempt. The intended 5-attempts/5-min throttle never engages, so an unbounded number of password guesses per IP is possible. The same bypass disables IP throttling on signup, password-reset, LDAP, WebAuthn, and account-switch endpoints for every hydrated user.

**Suggested fix:** Strip a trailing `.data` (and `_root.data`) suffix inside `normalizedPathname` in app/server/net.ts before the self-guard comparison, so single-fetch action/loader requests normalize to the same path the `match` predicates expect (e.g. `pathname.replace(/(?:\/_root)?\.data$/,'')`). Add an HTTP-level test that drives a hydrated POST to `/id/login/password.data` and asserts a 429 after the limit.

---

## 2. [HIGH] Unguarded provider.startIdpIntent crashes the login flow to the error boundary instead of the intended IDP_UNAVAILABLE result
**File:** `app/resources/login/login.service.ts:95`  | votes 3/3 | error-handling

**Defect:** startIdpIntent() awaits provider.startIdpIntent(idpId, {success, failure}) with no try/catch. It only maps the graceful failure case (result.authUrl falsy -> IDP_UNAVAILABLE). If the provider call itself throws a ProviderError (e.g. Zitadel UNAVAILABLE / DEADLINE_EXCEEDED, network blip), the exception propagates uncaught through the /login action (routes/login/index.tsx line 107) to the React Router root ErrorBoundary. The sibling implementation in resources/sso/sso-action.ts (lines 166-177) wraps the identical call in try/catch and maps ProviderError to a graceful branded SSO error redirect, proving the intended contract is graceful handling — the login entry point is inconsistent and treats a transient, recoverable provider outage as a fatal crash.

**Failure scenario:** User clicks 'Continue with Google' on /login while Zitadel returns a transient UNAVAILABLE (code 14). provider.startIdpIntent throws ProviderError; the service does not catch it; the action has no try/catch, so instead of the intended data({error:'IDP_UNAVAILABLE'}, {status:502}) with an inline retry message, the browser lands on a full-page error view and the login form/context is lost.

**Suggested fix:** Wrap the provider.startIdpIntent call in try/catch (mirroring sso-action.ts): on ProviderError, log an idp_start failure and return { ok:false, error:'IDP_UNAVAILABLE' } so the route surfaces the graceful 502 path; re-throw non-ProviderError.

---

## 3. [HIGH] Signup actions never enforce allowRegister (or allowPassword/passkeysType) — disabled registration is UI-only and bypassable by direct POST
**File:** `app/routes/signup/method.tsx:82`  | votes 3/3 | security-authz

**Defect:** The /signup/method action (and the /signup/password action at app/routes/signup/password.tsx:64) creates accounts via registerPasskeyFirst / registerEmailLinkSignup / registerWithPassword without ever checking the org's LoginSettings. resolveSignupView computes registrationDisabled = !settings.allowRegister, but that only hides buttons in the loader/JSX; the actions parse signupMethodSchema and go straight to provider.register. The codebase's own defense-in-depth policy is explicit: cypress/component/routes/signup/email-delivery-guard.cy.ts asserts the action must reject intent=email-link when AUTH_EMAIL_DELIVERY_ENABLED=false 'even if the UI hides the button', and app/resources/sso/sso-callback.ts:146 gates IdP auto-create on settings.allowRegister. The direct register paths have no equivalent gate: allowRegister, allowPassword (password intent + /signup/password), passkeysType ('passkey' intent), and disableLoginWithEmail ('email-link' intent) are all unenforced. The CSRF token is no obstacle: the /signup loader returns csrfToken in loader data even when registrationDisabled is true. Worse, both actions accept an arbitrary organization value from the form/URL, so the register lands in any org the caller names, regardless of that org's policy.

**Failure scenario:** Admin sets allowRegister=false in the Zitadel login policy. /signup renders 'Registration is currently unavailable'. An attacker loads /signup once (loader hands out csrfToken + csrf cookie), then POSTs to /id/signup/method with intent=passkey, loginName=victim@corp.com, firstName/lastName, csrf token — runEnumerationSafeRegister calls provider.register and creates the account (plus a ceremony session cookie) in the registration-disabled org. Same via /id/signup/password with allowPassword=false: a passkey-only org silently gains password-credentialed users.

**Suggested fix:** In both actions, after parsing, fetch getLoginSettings(await resolveOrg(provider, organization)) and return 400/403 when !settings.allowRegister; additionally gate intent=password and the /signup/password action on settings.allowPassword, intent=passkey on settings.passkeysType === 'allowed', and intent=email-link on settings.disableLoginWithEmail !== true (mirroring resolveSignupView), matching the existing email-delivery guard pattern.

---

## 4. [HIGH] /signup/complete drops requestId from the email link — OIDC/SAML ceremony never resumes after email-link signup
**File:** `app/routes/signup/complete.tsx:38`  | votes 3/3 | logic-error

**Defect:** registerEmailLinkSignup builds the verification email with signupCompleteUrlTemplate({ origin, requestId, organization }), which appends &requestId=<oidc_...> precisely so 'the post-verify step can resume an OIDC/SAML ceremony' (verify-url-template.ts docstring). But the /signup/complete loader reads only code, userId, organization, next, deviceTrackingToken — it never reads url.searchParams.get('requestId') and never passes it to completeEmailLinkSignup, whose CompleteEmailLinkInput.requestId (used for createSession({requestId}) and threaded into the /setup/passkey redirect) is therefore always undefined. The sibling email-link landing route app/routes/verify/index.tsx:36 does read requestId from the URL, confirming the intended contract. The ceremony context is irretrievably lost at this hop.

**Failure scenario:** User starts an OAuth flow at a client app → /authorize?requestId=oidc_123 → signup → 'Email me a sign-in link'. The email link is /signup/complete?code=...&userId=...&requestId=oidc_123. On click, the loader ignores requestId: the session is created without the auth request binding and the redirect is /setup/passkey?loginName=...&userId=... with no requestId. After the passkey nudge the user lands on /signed-in with no ceremony to finish — they are never redirected back to the OAuth client with an authorization code, and the client's login attempt hangs/fails despite the account being fully created and signed in.

**Suggested fix:** In the loader read const requestId = url.searchParams.get('requestId') ?? undefined (optionally validated against REQUEST_ID_PATTERN like nextStepWithParams does) and pass it into completeEmailLinkSignup so createSession binds the auth request and the /setup/passkey redirect carries requestId forward.

---

## 5. [HIGH] resolveSsoLink: unguarded getSession (and startIdpIntent) turns an expired session cookie into a raw 500
**File:** `app/resources/sso/sso-link.ts:81`  | votes 3/3 | error-handling

**Defect:** resolveSsoLink calls provider.getSession(recent.id, recent.token) with no try/catch. The Zitadel provider throws a ProviderError (NOT_FOUND) for an expired/invalid session — the codebase states this explicitly in sso-callback.ts:133 ('Zitadel getSession throws NOT_FOUND for an expired session') and both siblings defend against it: sso-management.ts:147-157 catches ProviderError and redirects, and sso-callback.ts:134 uses .catch(() => null). Here the error propagates to the root ErrorBoundary. The design intent for a missing/expired session is the 'sign-in-required' prompt branch (line 84), which is unreachable when getSession throws instead of returning null. provider.startIdpIntent at line 118 is likewise unguarded, unlike its guarded twin in runSsoAction (sso-action.ts:167-177), so a transient provider outage during link-intent start also 500s instead of redirecting to the branded SSO error page with an audit event.

**Failure scenario:** A signed-in user's ceremony session expires (or is deleted server-side) while their `sessions` cookie still holds the stale entry. They open /sso/link?provider=github (e.g., from the management screen or a saved link). getSession throws ProviderError NOT_FOUND → uncaught → root ErrorBoundary 500 page, instead of the intended 'You must be signed in to link an external account' prompt. Separately, any transient Zitadel UNAVAILABLE during startIdpIntent for a valid session also produces a 500 with no idp.link.start failure audit.

**Suggested fix:** Wrap the getSession call in try/catch (treat ProviderError as 'no session', matching sso-callback's .catch(() => null)), and guard startIdpIntent like sso-action.ts does: on ProviderError, logAuthEvent('idp.link.start','failure') and redirect to ssoErrorRedirect(wantedSlug, providerErrorCode(err.code)).

---

## 6. [HIGH] LDAP sign-in drops reauthClearCookie — stale reauth-intent marker survives and false-mismatches later logins
**File:** `app/resources/sso/sso-ldap.ts:78`  | votes 3/3 | state-machine

**Defect:** submitLdapCredentials destructures only { setCookie, target } from signInWithIdpIntent, discarding the reauthClearCookie the helper returns. The ReauthCheck contract (reauth-intent.ts:49-54) is explicit: 'Callers MUST append it on both the match and mismatch paths so a stale marker can never gate a later, unrelated login.' Every other completion factor honors this: the password path appends reauth.clearCookie (routes/login/password.tsx:85) and the SSO callback threads reauthClearCookie into its outcome (sso-callback.ts:241/273), which outcomeToResponse translates into a Set-Cookie. The LDAP path performs the reauth check inside signInWithIdpIntent (including the mismatch bounce to /accounts) but never clears the marker, so the 10-minute reauth-intent cookie survives the completed ceremony.

**Failure scenario:** User clicks 'Re-authenticate' for alice@acme.test on /accounts (reauth-intent cookie set, 10-min TTL), then signs back in via /sso/ldap as alice. Sign-in succeeds and the ceremony continues, but the reauth-intent cookie is never cleared. Within the next 10 minutes the user starts an unrelated login as bob@acme.test (password or IdP); checkReauthIntent reads the stale 'alice' intent, computes mismatch=true, and bounces them to /accounts?reauthMismatch=1 instead of completing that login — repeatedly, until the cookie expires.

**Suggested fix:** Destructure reauthClearCookie from signInWithIdpIntent and include it in the returned outcome: `return { kind: 'redirect', location: target, setCookie, reauthClearCookie };` — outcomeToResponse already appends it.

---

## 7. [HIGH] extractFailedAttempts calls ConnectError.findDetails() with no schema — it always throws internally and the catch swallows it, so failedAttempts is never extracted in production
**File:** `app/modules/auth/providers/zitadel/mappers.ts:85`  | votes 3/3 | error-handling

**Defect:** extractFailedAttempts does `e.findDetails?.() ?? []`. The real @connectrpc/connect ConnectError.findDetails(typeOrRegistry) immediately dereferences `typeOrRegistry.kind` (node_modules/@connectrpc/connect/dist/cjs/connect-error.js:95-96), so a no-arg call throws TypeError, which the surrounding try/catch silently swallows → returns undefined for every real ConnectError. Even if it returned details, real details are protobuf messages needing a schema (e.g. zitadel CredentialsCheckError), not plain objects with a failedAttempts key. The mirrored test (cypress/component/modules/auth/providers/zitadel/mappers.cy.ts:32-34) passes only because its double is `findDetails: () => details`, ignoring the missing argument. Compounding: normalizeError builds the ProviderError detail as {failedAttempts} only — maxAttempts is never populated — while login-view.attemptsRemaining (login-view.ts:59-61) returns null unless BOTH failedAttempts and maxAttempts are present.

**Failure scenario:** User enters a wrong password on live Zitadel → session setSession fails with INVALID_ARGUMENT carrying a CredentialsCheckError{failed_attempts} detail → extractFailedAttempts throws internally and returns undefined → verifyLoginPassword returns failedAttempts: undefined (login.service.ts:377) → attemptsRemaining returns null → the 'N attempts remaining / lockout imminent' warning in routes/login/password.tsx never renders, and the user is locked out with no prior warning.

**Suggested fix:** Call findDetails with the proper schema: import CredentialsCheckErrorSchema from @zitadel/proto (zitadel/session/v2 or message proto) and use e.findDetails(CredentialsCheckErrorSchema), converting bigint failedAttempts via Number(). Populate detail.maxAttempts too (or change attemptsRemaining to work from failedAttempts alone). Update the mirrored test double to require the schema argument so the regression is pinned.

---

## 8. [HIGH] serializeSessions eviction pre-pass uses Number() on ISO changeTs — size table is computed over the wrong session subset, so the emitted cookie can exceed the byte budget or over-evict
**File:** `app/modules/auth/session/cookie.ts:92`  | votes 3/3 | logic-error

**Defect:** serializeSessions builds its size-measurement pre-pass with `[...list].sort((a, b) => Number(b.changeTs) - Number(a.changeTs))`. Production SessionEntry.changeTs values are ISO-8601 strings (sessionEntryFromSession copies Session.changedAt, produced by tsToIso in app/modules/auth/providers/zitadel/mappers.ts:233; login/signup/sso/otp/webauthn writers all store it verbatim), and Number(ISO) is NaN, so the comparator returns NaN for every ISO pair and the 'byNewest' array is NOT newest-first — it is just the original cookie order (NaN comparator results are treated as 0). The sibling module session.ts explicitly handles this dual format via tsMs() (its doc comment says `Number(ISO)` is NaN and 'silently broke expiry filtering and recency sorting — parse both'), and capSessions uses tsMs correctly. The result: the pre-pass measures the signed payload size of 'first-k entries in cookie order' subsets and keys them by length k, while capSessions decides membership as the TRUE newest-k by tsMs. Since entries differ in byte size (loginName lengths, optional organization/requestId), the sizeOf lookup returns the size of a different subset than the one capSessions keeps and serializeSessions ultimately signs. Mixed formats make it worse: session.service.ts:581 writes epoch `String(Date.now())` while other writers store ISO, so the broken comparator interleaves NaN and real numbers arbitrarily. The mirrored overflow test (cypress/support/node/harness.ts op 'overflow', asserted in cypress/component/modules/auth/session/cookie.cy.ts) only uses numeric-epoch changeTs values ('100', '200', …), which is why the 2048-byte invariant it asserts never catches this.

**Failure scenario:** A multi-account user has 5 sessions in the cookie, all with ISO changeTs (normal Zitadel path). Cookie order happens to be [old-small, old-small, new-big, new-big, new-big] (older entries have short loginNames and no requestId; newer ones have long loginNames + organization + requestId). Pre-pass: byNewest stays in cookie order (NaN sort is a no-op), k=5 exceeds 2048 bytes, k=4 measures the FIRST four entries (2 small + 2 big) and fits, so sizeByLength(4)=fits. capSessions (correct tsMs sort) keeps the true newest four (3 big + 1 small), whose real signed payload is larger — the final serializeSessions output exceeds the 2048-byte budget. Combined with the origin's other cookies this can cross the ~4KB per-cookie/browser limit, and the browser silently drops the Set-Cookie: the user is logged out of every account at once. The inverse mis-measurement (true newest-k smaller than measured first-k) silently evicts a still-live session that actually fit, logging the user out of one account for no reason.

**Suggested fix:** Use the same dual-format timestamp parsing as session.ts in the pre-pass: export tsMs from app/modules/auth/session/session.ts and sort with `tsMs(b.changeTs) - tsMs(a.changeTs)` (and the ascending candidate re-sort at lines 95-97 likewise), so the pre-pass candidates are exactly the subsets capSessions will keep. Add an overflow test variant with ISO changeTs (and one mixing ISO with String(Date.now()) entries) to pin the invariant.

---

## 9. [HIGH] resendEmailCode has no session-ownership gate — arbitrary verification-email flood to any userId
**File:** `app/resources/verify/verify.service.ts:132`  | votes 3/3 | security

**Defect:** dispatchEmailCode (the GET ?send=true path) was explicitly hardened to resolve the active session and call provider.getSession to confirm the caller's session owns `userId` before dispatching (see the enumeration/flood rationale in its docstring, lines 51-63). The POST intent=resend path calls resendEmailCode, which performs NO ownership check at all — its only guard is `if (!userId) return INVALID_INPUT`. It takes `userId` straight from the attacker-controllable hidden form field and calls provider.resendEmailCode(userId, template), sending a verification/invite email to whatever account that id names. The GET dispatch is additionally rate-limited (verifyEmailSendRateLimit), but that middleware self-guards to `c.req.method === 'GET'` (rate-limit.ts:73), so the POST resend path is entirely unbounded. CSRF is not a mitigation: an attacker obtains a valid CSRF token for their own session by loading /verify, then POSTs directly.

**Failure scenario:** Attacker loads GET /id/verify to receive a CSRF token+cookie, then repeatedly POSTs /id/verify with intent=resend, code=resend, userId=<victim's Zitadel user id> and the CSRF token. resendEmailCode never verifies the session owns that userId and is not rate-limited on POST, so each request mails a fresh verification code to the victim — an unbounded email-flood / bombing vector against arbitrary accounts, exactly the attack dispatchEmailCode was written to prevent. A valid userId also yields 200 CODE_SENT while an invalid one throws (→ 500), giving an enumeration oracle.

**Suggested fix:** Give the resend branch the same ownership gate as dispatchEmailCode: resolve the signed-cookie session, call provider.getSession, and only resend when activeSession.user.id === userId; otherwise fail closed. Also extend verifyEmailSendRateLimit (or add a sibling) to cover the POST resend path.

---

## 10. [HIGH] Device-authorization grant is auto-applied from a forgeable GET (/signed-in) with no CSRF or consent proof
**File:** `app/resources/session/session.service.ts:111`  | votes 3/3 | security

**Defect:** resolveSignedIn() runs inside the /signed-in route's GET loader (app/routes/signed-in.tsx — no assertCsrf, it's a loader). When it sees requestId starting with 'device_' and any active cookie session, it calls resolveDeviceCompletion() which invokes provider.authorizeDevice(deviceAuth.id, { session: recent }) — a state-changing RFC 8628 consent grant — using the victim's server-side session token. The requestId is a global device user_code taken verbatim from the query string; it is never checked against per-user state, never CSRF-token-gated, and there is no evidence the user ever saw the /device/authorize consent screen. The real device-consent POST at /device/authorize IS CSRF-protected (assertCsrf) and requires an explicit Authorize click, so this GET path is a protection/consent regression. The sessions cookie is SameSite=lax (app/modules/auth/session/cookie.ts), so a cross-site top-level GET navigation still carries it.

**Failure scenario:** Attacker starts an OAuth device-authorization flow at the RP and obtains user_code WDJB-MJHT (device now polling for tokens). Attacker sends a logged-in victim a link to https://auth.datum.net/id/signed-in?requestId=device_WDJB-MJHT. The victim clicks it (top-level GET, lax cookie sent). resolveSignedIn sees recent session + device_ requestId, resolveDeviceCompletion re-resolves getDeviceAuth('WDJB-MJHT') and calls authorizeDevice against the victim's session. The attacker's device receives tokens for the victim's account — device authorization granted without the victim ever seeing or approving the consent screen.

**Suggested fix:** Do not perform authorizeDevice from an unauthenticated GET. Require the device auto-complete to be reached only via a POST that asserts CSRF, or gate it behind a server-verified marker proving the user actually passed the /device/authorize consent screen for this user_code in this session (e.g. a signed one-time continuation token minted at consent time), rather than trusting a bare device_<code> query param.

---

## 11. [HIGH] Rate-limit mounts are case-sensitive while React Router matches case-insensitively, so `/id/Login/password` bypasses the limiter
**File:** `app/server.ts:102`  | votes 3/3 | security-authn-ratelimit-bypass

**Defect:** The auth limiters are mounted with case-sensitive Hono paths (`app.use('/id/login/*', loginPasswordRateLimit)`, `'/id/signup/*'`, `'/id/sso/ldap'`, `'/id/accounts'`, `'/id/password/*'`, etc., lines 102-141). Hono static-segment matching is case-sensitive — I verified `app.request('/id/Login/password')` and `/id/LOGIN/password` do NOT invoke a `/id/login/*` middleware, and `/id/Signup` does not invoke `/id/signup/*`. React Router, however, matches routes case-insensitively by default (verified: matchRoutes with basename `/id/` maps `/id/Login/password`, `/id/LOGIN/password`, `/id/Signup` all to their actions), and stripBasename is also case-insensitive. So a case-variant of any static path segment reaches the RR action but skips the Hono limiter mount entirely — meaning the self-guard's `.toLowerCase()` normalization in net.ts never even runs, because the middleware is never invoked. The in-code comment at lines 97-99 explicitly claims the mount defends against "case variants that RR7 still routes to the action," but it does not: the mount itself is the case-sensitive gate.

**Failure scenario:** An attacker brute-forces a password by POSTing to `/id/Login/password` (capital L) with `loginName=victim@acme.com&password=<guess>&csrf=<token>`. Hono's case-sensitive `/id/login/*` mount does not match `/id/Login/...`, so loginPasswordRateLimit (and the co-mounted webauthnVerifyRateLimit) never runs. React Router strips the `/id/` basename case-insensitively and matches `login/password` case-insensitively, so `verifyLoginPassword` executes normally. The attacker rotates case patterns (`/id/lOgin/password`, `/id/LOGIN/password`, ...) for additional distinct un-throttled paths. This bypass works even for non-hydrated native POSTs, and is independent of the `.data` single-fetch bypass.

**Suggested fix:** Do not rely on case-sensitive mount paths for a security control. Mount the limiters on `*` (or normalize the request path to lowercase before routing), and let each middleware's already-normalized self-guard decide — or configure the Hono app so path matching is case-insensitive to match RR's behavior.

---

## 12. [HIGH] Unhandled ProviderError from registerTotp in loader dead-ends TOTP-enrolled users on a generic 500 error page
**File:** `app/routes/setup/authenticator.tsx:47`  | votes 3/3 | error-handling

**Defect:** The /setup/authenticator loader calls `await provider.registerTotp(user.id)` with no try/catch. The Zitadel adapter (app/modules/auth/providers/zitadel/mfa.ts:147) wraps the RPC in ctx.call, which normalizes gRPC failures into thrown ProviderError (context.ts:51-58). Zitadel's RegisterTOTP RPC fails (AlreadyExists/FailedPrecondition) when the user already has a verified TOTP, so the loader throws straight to the root ErrorBoundary. This is reachable through normal UI: resolveMfaSetup/offerableSetupRoutes (mfa.service.ts:215-227) gates the /setup/mfa chooser rows only on provider capability + org login policy — it never filters out already-enrolled methods — so a TOTP-enrolled user is still shown the 'Authenticator app' row, and clicking it crashes. The mirrored test (cypress/component/routes/setup/authenticator-guard.cy.ts) only covers the missing-session guard, not this path. The action side of the same ceremony (enrollTotp in otp.service.ts) carefully maps ProviderError to typed 400/401 responses, so the loader's bare await is an omission, not a design choice.

**Failure scenario:** User u2 with a verified TOTP factor signs in, navigates to /setup/mfa (or hits Back from an enrollment leaf, whose previous-step map returns to /setup/mfa) and clicks 'Authenticator app'. The loader calls registerTotp → Zitadel returns 'TOTP already configured' → ProviderError thrown from the loader → root ErrorBoundary renders the generic 'Something went wrong' page. The user cannot recover or learn the real reason, and any active OIDC ceremony (requestId) is lost.

**Suggested fix:** Wrap the registerTotp call in try/catch: on ProviderError with code ALREADY_EXISTS/FAILED_PRECONDITION redirect to `/login/verify/authenticator?${threadParams(loginName, requestId, organization)}` (the factor already exists — verifying is the sensible continuation), and on other ProviderErrors render an inline challengeFailed-style error like setup/passkey does instead of throwing.

---

## 13. [HIGH] Login IdP action branch awaits startIdpIntent with no try/catch — transient ProviderError escapes to the root ErrorBoundary
**File:** `app/routes/login/index.tsx:107`  | votes 3/3 | error-handling

**Defect:** The `intent === 'idp'` branch of the /login action awaits `startIdpIntent(provider, …)` bare. `provider.startIdpIntent` runs through the Zitadel ctx.call/withDeadline wrapper (app/modules/auth/providers/zitadel/context.ts), which throws ProviderError('UNAVAILABLE') on the RPC deadline and other ProviderErrors (DEADLINE_EXCEEDED, NOT_FOUND for a deleted IdP). Both sibling entry points handle this exact call: app/routes/signup/index.tsx:105-123 wraps it in try/catch → actionError(err) (inline 503 error), and app/resources/sso/sso-action.ts:168-177 catches ProviderError → branded /sso/:slug/error redirect. Only the /login entry point lets it escape uncaught to the root ErrorBoundary.

**Failure scenario:** User clicks "Continue with Google" on /login while Zitadel is briefly unreachable (or the 5s gRPC deadline fires). startIdpIntent rejects with ProviderError('UNAVAILABLE'); the action throws; the user is dumped on the full-page branded error boundary (500) and loses the login page state — while the identical click on /signup shows a recoverable inline "service unavailable" message.

**Suggested fix:** Mirror signup/index.tsx: wrap the startIdpIntent call (and the result mapping) in try/catch and return actionError(err), e.g. `try { const result = await startIdpIntent(...); ... } catch (err) { return actionError(err); }`.

---

## 14. [HIGH] Registration-disabled (allowRegister) policy is enforced only in the UI view, not in the signup action handlers — a crafted POST creates accounts in an org that closed registration
**File:** `app/routes/signup/method.tsx:92`  | votes 3/3 | authorization-bypass

**Defect:** The org's `allowRegister` login setting is consumed in exactly one place: resolveSignupView (app/resources/signup/signup-view.ts:35) which maps `!settings.allowRegister` to `registrationDisabled`, a boolean the UI uses to hide the form (signup/index.tsx:206). None of the three register action handlers re-check it. signup/method.tsx action registers via registerEmailLinkSignup (line 92) and registerPasskeyFirst (line 109); signup/password.tsx action registers via registerWithPassword (line 85). All three call provider.register unconditionally. The signup.service.ts register functions (registerEmailLinkSignup, registerPasskeyFirst, registerWithPassword) also never inspect allowRegister — a grep shows the flag is referenced only in signup-view.ts and for display in signup/index.tsx. Zitadel's addHumanUser (called by the BFF with a service account) does not enforce the org self-registration policy, so there is no backend backstop: the gate lives purely in the presentation layer.

**Failure scenario:** Org sets allowRegister=false (self-service signup closed). An attacker does GET /id/signup/method (its loader runs loaderCsrf unconditionally, issuing a CSRF token + cookie even though registration is disabled), then POSTs to /id/signup/method with body `intent=email-link&loginName=attacker@x.com&firstName=A&lastName=B&csrf=<token>`. signupMethodSchema.safeParse succeeds, no allowRegister check runs, and registerEmailLinkSignup calls provider.register — creating a fully registered account (and dispatching a verification email) in an org that explicitly disabled registration. The same bypass works via intent=passkey and via a direct POST to /id/signup/password.

**Suggested fix:** Re-fetch getLoginSettings(resolveOrg(...)) in each signup action (or inside the service register functions) and short-circuit with a 403/INVALID_INPUT when settings.allowRegister is false, mirroring how signup/method.tsx already re-checks env.AUTH_EMAIL_DELIVERY_ENABLED server-side for the email-link path.

---

## 15. [MEDIUM] Post-identifier routing decision uses the ceremony/default org's login settings, not the instance-wide-found user's own org
**File:** `app/resources/login/login.service.ts:266`  | votes 3/3 | org-scoping

**Defect:** findUser is deliberately instance-wide (org may be undefined on a bare /login) so cross-org users can sign in — confirmed by resolve-identifier-instance-wide.cy.ts and the loader comment. But the settings that drive decideAfterIdentifier are fetched with the ceremony `org` (undefined) or the caller-threaded settings, which the route obtains via resolveOrg(organization) = the DEFAULT org's settings. The resolved User carries user.orgId, but it is never used to fetch the policy. So a user found in org-B via bare /login has their available sign-in methods gated by the default org's allowPassword/allowExternalIdp/passkeysType instead of org-B's policy.

**Failure scenario:** Default org sets allowPassword=false; org-B sets allowPassword=true. Alice belongs to org-B and has only a password method. She opens bare /login (no ?organization=), types alice@org-b.test. findUser finds her instance-wide, but decideAfterIdentifier runs against default-org settings (allowPassword=false) -> available=[] -> {kind:'error','PASSWORD_NOT_ALLOWED'} -> redirect to /error. Alice is locked out even though her own org permits password login.

**Suggested fix:** When the user is found and no explicit organization was pinned, fetch getLoginSettings for the found user's org (user.orgId) before calling decideAfterIdentifier, rather than reusing default-org/instance settings.

---

## 16. [MEDIUM] Set-Cookie header distinguishes fresh vs duplicate email on the 'check your email' response — breaks documented enumeration safety
**File:** `app/routes/signup/method.tsx:128`  | votes 3/3 | security-enumeration

**Defect:** The enumeration-safety contract (genericCheckYourEmail docstring: 'Both the new-user path and the duplicate-email (ALREADY_EXISTS) path MUST return the same response'; signup.service.ts comments: 'a duplicate email is indistinguishable from a new account') is violated at the header level. For intent=passkey with requireVerification on, a fresh email yields kind='sent-with-session' → 200 with a 'set-cookie: <session cookie>' header (method.tsx lines 128–133), while an existing email yields kind='sent' → genericCheckYourEmail → 200 with NO Set-Cookie. Bodies are identical ({sent:true,email}) but the header difference is a reliable oracle. The identical divergence exists in app/routes/signup/password.tsx lines 98–104 for the password register path.

**Failure scenario:** Attacker fetches /signup once for a CSRF token, then POSTs candidate emails to /id/signup/method with intent=passkey. Response for probe1@corp.com contains 'Set-Cookie: <sessions cookie>' → email was NOT registered; response for ceo@corp.com has no Set-Cookie → an account exists. The attacker enumerates valid accounts at scale despite the deliberately-generic response body, defeating the exact property the code documents and tests (signup.service.cy.ts 'no enumeration' spec only checks the service result kind, not the route's headers).

**Suggested fix:** Make the header surface uniform: on the 'sent' (duplicate) branch also emit a Set-Cookie — e.g. serialize the caller's existing session list unchanged (serializeSessions(await readSessions(request))) so both branches return 200 + a sessions Set-Cookie of similar shape, in both method.tsx and password.tsx.

---

## 17. [MEDIUM] MaxMind deviceTrackingToken passed as the fingerprintId argument of userAgentFromRequest in all three signup routes
**File:** `app/routes/signup/method.tsx:116`  | votes 3/3 | incorrect-api-usage

**Defect:** userAgentFromRequest(request, fingerprintId?) expects the long-lived fingerprintId cookie UUID as its second parameter ('explicit param overrides the cookie'), and every other caller follows that: login/index.tsx:132-138 and sso-callback.ts:90/248/302/404 pass the id from getOrCreateFingerprintId(request). The signup routes instead pass the MaxMind device-tracking token (method.tsx:116, password.tsx:93, complete.tsx:62) — a completely different identifier whose correct destination is the session metadata key 'maxmind/tracking-token' (which the service already sets separately). Two consequences: (1) when the token is present it OVERRIDES the browser's legitimate 1-year fingerprintId cookie ('fingerprintId || fingerprintIdFromCookie(request)'), so the Zitadel session records the MaxMind token as the device fingerprint; (2) signup never calls getOrCreateFingerprintId, so unlike login/SSO it never mints the fingerprint cookie for new browsers — the very first session of a brand-new user has either a wrong fingerprintId or none.

**Failure scenario:** MAXMIND_ACCOUNT_ID is set; a returning browser carrying the old app's fingerprintId cookie signs up via /signup/password. The route passes deviceTrackingToken as fingerprintId, so the created Zitadel session's userAgent.fingerprintId is the MaxMind token, not the cookie UUID. Downstream device-recognition (Active Sessions Device/Location, fraud device continuity keyed on fingerprintId) sees a different 'device' for this user's signup session than for every subsequent login session on the same browser, and the fingerprintId field now varies per-page-load with MaxMind token rotation instead of being the stable 1-year device id.

**Suggested fix:** In method.tsx, password.tsx and complete.tsx, call const [fingerprintId, fpCookie] = getOrCreateFingerprintId(request), pass userAgent: userAgentFromRequest(request, fingerprintId), append fpCookie to the response headers when non-null, and keep deviceTrackingToken solely in the session-metadata path (already handled by the service).

---

## 18. [MEDIUM] provider.getUser sits outside the try/catch — a NOT_FOUND ProviderError crashes to the ErrorBoundary instead of the promised 'Link expired' 400
**File:** `app/routes/signup/complete.tsx:48`  | votes 3/3 | error-handling

**Defect:** The route's header comment promises 'a spent code causes … caught → 400 expired state, never a 500', and the ProviderError catch (lines 72-74) maps provider failures to the friendly EXPIRED card. But the user lookup at line 48 runs BEFORE the try block. Against the real Zitadel provider, getUser throws rather than returning null for an unknown user: getUserByID on a missing/deleted user fails with gRPC NotFound (code 5), which normalizeError (zitadel/mappers.ts:77 GRPC_CODE map) converts to ProviderError('NOT_FOUND') and ctx.call rethrows — the 'resp.user ? toUser : null' branch (user.ts:126) never yields null in that case, so the if (!user) guard at line 49 is effectively fake-provider-only. The thrown ProviderError escapes the loader uncaught and renders the generic ErrorBoundary.

**Failure scenario:** A user registers via email-link; before clicking the verification link, the pending account is deleted (admin cleanup of unverified users, or the user retries signup after the org purges stale registrations). Clicking the emailed /signup/complete?code=...&userId=<deleted-id> link makes getUser throw ProviderError('NOT_FOUND') outside the try → uncaught in the loader → the user gets the app's error-boundary crash page instead of the intended 'Link expired / Start over' 400 card. Same result for any tampered userId in the link.

**Suggested fix:** Move the provider.getUser(userId) call (and the !user guard) inside the existing try block so ProviderError from the lookup is mapped to the EXPIRED state like every other provider failure in this loader.

---

## 19. [MEDIUM] Unlink action: unguarded getSession makes the intended 'session expired → graceful null response' branch unreachable, yielding a 500
**File:** `app/resources/sso/sso-action.ts:79`  | votes 3/3 | error-handling

**Defect:** The unlink branch calls provider.getSession(recent.id, recent.token) with no guard. Lines 81-84 clearly intend an expired/absent session to hit the `!userId` branch ('Session expired/absent … keep the probe observable') and return an empty response with a no_session audit event. But with the real Zitadel provider, an expired session makes getSession THROW ProviderError NOT_FOUND (per sso-callback.ts:133 and the defensive handling in sso-management.ts:147-157), bypassing the null-check entirely and escaping to the root ErrorBoundary. The intended fail-soft path only works for a missing cookie, not the far more common expired-session case.

**Failure scenario:** User leaves the /sso management page open until their Zitadel session expires, then clicks Unlink and confirms. The POST reaches runSsoAction with a valid CSRF token and a stale sessions cookie; getSession throws ProviderError NOT_FOUND → uncaught → 500 error page, and no idp.unlink/no_session audit event is emitted (losing the probe observability the comment promises).

**Suggested fix:** Wrap getSession in try/catch and treat a ProviderError as session=null (mirroring sso-management.ts), so the existing no_session branch handles it.

---

## 20. [MEDIUM] Callback sign-in branch rethrows ProviderError from createSession — returning users get a raw 500 while link/auto-create branches get the branded error page
**File:** `app/resources/sso/sso-callback.ts:251`  | votes 3/3 | error-handling

**Defect:** The 'sign-in' branch catch (lines 251-260) logs an idp.signin failure and then rethrows ALL errors, including ProviderError. The two sibling terminal branches handle the identical failure mode gracefully: 'link'/'auto-link' (lines 333-356) and 'auto-create' (lines 416-432) both map ProviderError to a redirect to /sso/:provider/error with a providerErrorCode-mapped reason. The result is that the most common branch — a returning, already-linked user — is the only one where a transient Zitadel failure during createSession escapes to the root ErrorBoundary instead of the branded 'Couldn't sign in' page (which already has copy for signin_failed). It also skips the deps.onAuthEvent failure hook that the pre-decision catch invokes.

**Failure scenario:** A returning user clicks 'Continue with Google'; the IdP round-trip succeeds and decideIdpCallback resolves 'sign-in'. Zitadel is transiently unavailable (or the intent token was already consumed) when signInWithIdpIntent's createSession runs → ProviderError UNAVAILABLE/FAILED_PRECONDITION → rethrown → generic root ErrorBoundary 500 instead of /sso/google/error?reason=signin_failed with its 'Return to your application and try again' guidance.

**Suggested fix:** In the sign-in branch's catch, after logging, add: if (err instanceof ProviderError) { deps.onAuthEvent?.('idp.signin','failure'); return { kind: 'redirect', location: ssoErrorRedirect(slug, providerErrorCode(err.code)) }; } and rethrow only unknown errors, mirroring the sibling branches.

---

## 21. [MEDIUM] link/auto-link createSession drops the deviceTrackingToken — MaxMind fraud metadata lost on auto-linked sign-ins
**File:** `app/resources/sso/sso-callback.ts:296`  | votes 3/3 | logic

**Defect:** processIdpCallback parses deviceTrackingToken from the callback query (line 85) and forwards it on the 'sign-in' branch (via signInWithIdpIntent's metadata, line 249) and the 'auto-create' branch (via registerAndLinkIdp, line 405). The 'link'/'auto-link' branch's own createSession call (lines 296-304) passes no metadata at all, so the token is silently discarded. The mirrored tests (sso-callback.cy.ts 'MaxMind fraud-signal parity' suites) establish that BOTH other session-minting branches must attach the token as maxmind/tracking-token metadata; auto-link is entered from the very same login/signup IdP entry points that thread the token (per this branch's deviceTrackingToken work), so the omission breaks the stated parity.

**Failure scenario:** ALLOW_IDP_AUTO_LINK=true. A user with an existing passwordless account clicks 'Continue with Google' on the login page; the client-captured MaxMind token rides the callback URL (?deviceTrackingToken=mm-…). decideIdpCallback resolves 'auto-link'; the session is created WITHOUT the maxmind/tracking-token metadata, so the fraud pipeline receives no device signal for precisely the riskiest event — a first-time IdP link onto an existing account — while an ordinary sign-in or fresh registration from the same button would have carried it.

**Suggested fix:** In the link/auto-link branch, build the same metadata object used by signInWithIdpIntent (deviceTrackingToken ? { [MAXMIND_TRACKING_TOKEN_METADATA_KEY]: deviceTrackingToken } : undefined) and pass it in the createSession opts.

---

## 22. [MEDIUM] forceMfaLocalOnly is collapsed into forceMfa, forcing MFA setup on IdP-authenticated logins the org policy explicitly exempts
**File:** `app/modules/auth/providers/zitadel/mappers.ts:343`  | votes 3/3 | logic-error

**Defect:** toLoginSettings computes `forceMfa: Boolean(proto.forceMfa) || Boolean(proto.forceMfaLocalOnly)`. In Zitadel, force_mfa_local_only means MFA is enforced ONLY for locally-authenticated users (password/passkey) and explicitly NOT for users authenticating through an external IdP (the IdP is trusted to handle MFA). The neutral LoginSettings has a single forceMfa boolean, and nextMfaStep step 5 (app/resources/mfa/mfa-routing.ts:116) applies it unconditionally — including to sessions whose only primary factor is idpIntent (primaryFresh treats idpIntent as primary, lifetimes.ts:23). No production code or test references forceMfaLocalOnly except this line and one fixture.

**Failure scenario:** Org sets force_mfa_local_only=true (force_mfa=false) because its Google Workspace IdP already enforces 2FA. A user signs in via that IdP, then switches accounts or re-enters via a nextStep-computing path: settings.forceMfa arrives as true → nextMfaStep step 5 returns forced /setup/mfa?force=true → the IdP user is blocked behind mandatory in-app MFA enrollment that the org policy deliberately disabled for IdP logins.

**Suggested fix:** Add forceMfaLocalOnly as its own field on the neutral LoginSettings, map both fields separately in toLoginSettings, and in nextMfaStep step 5 apply forceMfaLocalOnly only when the session's primary factor is NOT idpIntent (i.e. skip forced setup when factors.idpIntent is the fresh primary).

---

## 23. [MEDIUM] OTP audit failure events log raw loginName (PII) instead of a hashed actor
**File:** `app/resources/otp/otp.service.ts:215`  | votes 3/3 | security

**Defect:** observability.ts states audit logs must NEVER carry a raw loginName or email, and every other flow passes hashActor(loginName) (the mfa and webauthn cypress specs assert `failure?.loginName === undefined` and a hashed `actor`). otp.service.ts violates this in three audit calls that write the raw loginName straight into the log line: submitOtpCode's verify-failure (line 215, `{ loginName, channel }`), dispatchEmailChallenge (line 85), and dispatchSmsChallenge (line 106). These are the OTP-email/SMS/authenticator verify + challenge paths, so real end-user email addresses land in the structured audit sink on every failed or attempted OTP.

**Failure scenario:** A user with loginName alice@acme.test submits a wrong email OTP. submitOtpCode's catch logs `logAuthEvent('mfa_otp','failure',{ loginName:'alice@acme.test', channel:'email' })`, emitting the raw email into the compliance audit log — a PII leak that the equivalent webauthn/mfa paths avoid by hashing. Any email-OTP challenge send failure logs the same raw email.

**Suggested fix:** Replace the raw `loginName` field with `actor: hashActor(loginName)` in these logAuthEvent calls, matching webauthn.service.ts's fixed pattern and the cypress hashed-actor assertions.

---

## 24. [MEDIUM] WebAuthn assertion/challenge audit failures log raw loginName (PII)
**File:** `app/resources/webauthn/webauthn.service.ts:200`  | votes 3/3 | security

**Defect:** Same policy violation as the OTP service: requestWebAuthnChallenge (line 131) and verifyWebAuthnAssertion's failure paths (lines 183 and 200) log `{ loginName }` / `{ loginName, reason:'session_expired' }` with the raw loginName, while the setup/attestation paths in the same file correctly use `actor: hashActor(loginName)` (lines 330, 183 is session_expired). The webauthn.service cypress spec explicitly asserts `failure?.loginName === undefined` and a pseudonymized `actor`, so the challenge/assertion verify paths are inconsistent with both the documented policy and the test contract for the sibling enrollment paths.

**Failure scenario:** A passkey or security-key assertion fails (bad credential or a provider error) for alice@acme.test: verifyWebAuthnAssertion logs `logAuthEvent('mfa_passkey','failure',{ loginName:'alice@acme.test' })` at line 200, writing the raw email into the audit log. Likewise a challenge-request failure at line 131 logs the raw loginName.

**Suggested fix:** Use `actor: hashActor(loginName)` in requestWebAuthnChallenge and verifyWebAuthnAssertion's failure logs, as already done in requestPasskeyAttestation.

---

## 25. [MEDIUM] submitEmailCode reflects unvalidated, unencoded requestId into the /authorize redirect
**File:** `app/resources/verify/verify.service.ts:192`  | votes 2/3 | security

**Defect:** On a successful email/invite verification with an active session, submitEmailCode returns `target: \`/authorize?requestId=${requestId}\`` using the raw requestId parsed by verifyCodeSchema (z.string().optional()) with no encoding and no REQUEST_ID_PATTERN check. Everywhere else in the codebase requestId is threaded through nextStepWithParams, which validates it against REQUEST_ID_PATTERN (oidc_/saml_/device_) and drops/encodes it precisely to avoid reflecting an attacker-supplied value into the OIDC hand-back. This path bypasses that hardening; the requestId originates from the emailed link's query string, which an attacker can craft.

**Failure scenario:** An attacker sends a victim a verification link whose requestId contains an injected parameter, e.g. requestId=oidc_abc%26sessionId%3D<attacker-sid>. After the victim (with an active session) verifies, submitEmailCode emits `Location: /authorize?requestId=oidc_abc&sessionId=<attacker-sid>`, injecting an unintended sessionId (and any other `&`-delimited params) into the OIDC authorize hand-back — a parameter-injection surface the validated path is specifically designed to close. A requestId with raw spaces/control chars also produces a malformed Location header.

**Suggested fix:** Validate requestId against REQUEST_ID_PATTERN and build the query with URLSearchParams/encodeURIComponent (or route through authorizeHandbackTarget/nextStepWithParams), dropping the value when it doesn't match the allowlist.

---

## 26. [MEDIUM] Password-reset audit event logs the raw loginName (email/username) as PII
**File:** `app/resources/password/password.service.ts:74`  | votes 3/3 | security

**Defect:** requestPasswordReset() ends with logAuthEvent('password.reset.requested', 'success', { loginName }) passing the raw user-typed loginName. The observability module's own contract states: "Audit logs must never carry a raw loginName or email. Callers pass hashActor(loginName)" — every other actor field in this codebase (device_authorize, account_switch/remove, logout) uses hashActor(). This call writes the raw email/username straight into the structured audit log line (JSON.stringify to the audit sink / stdout). It fires in BOTH the found and not-found branches, so it leaks the identifier for every reset attempt, including enumeration probes for accounts that don't exist.

**Failure scenario:** A user (or an attacker probing accounts) submits the reset form with loginName='victim@example.com'. requestPasswordReset always reaches line 74 and emits {"kind":"auth_event","event":"password.reset.requested","outcome":"success","loginName":"victim@example.com"} to the audit log — raw PII persisted to logs in violation of the module's documented no-raw-identifier invariant.

**Suggested fix:** Pass an anonymized actor instead: logAuthEvent('password.reset.requested', 'success', { actor: hashActor(loginName) }) — matching hashActor usage at every other audit call site.

---

## 27. [MEDIUM] Real browsers without WebAuthn are routed into the Cypress fake-credential path; the 'unsupported' error branch is unreachable dead code
**File:** `app/components/webauthn-button/webauthn-button.tsx:93`  | votes 3/3 | logic-error

**Defect:** handleClick uses `if (isCypress || !isWebAuthnSupported()) { credential = CYPRESS_CREDENTIAL; }`. The only code that throws WebAuthnUnsupportedError is marshalAssertion/createAttestation (app/resources/webauthn/webauthn.ts:49,86), which are reached only when isWebAuthnSupported() is TRUE. So the `catch` branch `setError('webauthn-unsupported')` (line 127) and its user-facing message 'Your browser does not support passkeys. Please use a supported browser.' (line 138, present in the compiled i18n catalog) are unreachable. Instead, a real user on a browser lacking window.PublicKeyCredential submits the hardcoded CYPRESS_CREDENTIAL (a base64 'fake-credential-id' payload) to the production Zitadel backend, which rejects it. The mirrored test (cypress/component/components/webauthn-button/webauthn-button.cy.tsx) only exercises the window.Cypress path, so this misrouting is untested. The dead branch plus the translated copy prove the intent was for unsupported browsers to see the unsupported message without a server round-trip.

**Failure scenario:** A user on a browser/webview without PublicKeyCredential (e.g. Firefox with security.webauth disabled, older Android webview) opens /login/passkey or /setup/passkey and clicks the button. The component POSTs the fake credential to Zitadel; verification fails and the user sees the misleading 'The passkey verification failed. Please try again.' / 'We couldn't set up your passkey.' instead of the unsupported-browser message. Retries send more garbage assertions that, on the login path, register as failed authentication attempts against the account (potentially feeding Zitadel lockout counters).

**Suggested fix:** Split the condition: only use CYPRESS_CREDENTIAL when `isCypress`; for `!isWebAuthnSupported()` call `setError('webauthn-unsupported'); return;` before attempting any submit. (Optionally also render the unsupported state on mount so users don't need to click first.)

---

## 28. [MEDIUM] Process-global default-org cache is not keyed by provider/service URL — cross-instance org bleed in multi-forward-host deployments
**File:** `app/resources/shared/resolve-org.ts:28`  | votes 3/3 | org-scoping

**Defect:** `cachedDefaultOrg` is a module-level singleton, but the provider it memoizes for is constructed PER REQUEST with a per-request serviceUrl: providerForRequest (app/server/composition.ts:11-19) calls resolveServiceUrl, which honors the allowlisted `x-zitadel-forward-host` header (transport.util.ts:24-39, ZITADEL_TRUSTED_FORWARD_HOSTS supports multiple hosts), and getAuthProvider builds a new ZitadelAuthProvider per call. getCachedDefaultOrg ignores which instance the provider points at: the first instance to answer wins and its default-org id is served to every other instance for the process lifetime. resolveOrg feeds this org into getLoginSettings/getBranding and register-path default-org resolution across the app (mfa.service.ts, otp-enroll.ts, login/signup loaders). The cypress spec (resolve-org.cy.ts) only tests a single provider, and the recorded design notes only acknowledge the no-TTL staleness tradeoff — not the cross-instance keying flaw.

**Failure scenario:** ZITADEL_TRUSTED_FORWARD_HOSTS=['a.zitadel.example','b.zitadel.example']. Request 1 arrives for instance A with no explicit ?organization → getDefaultOrg on instance A returns org-A, which is cached. Request 2 arrives for instance B (forward host b.zitadel.example) with no explicit org → resolveOrg returns org-A → getLoginSettings(org-A)/getBranding(org-A) are queried against instance B, yielding NOT_FOUND or, worse, instance B silently rendering the wrong tenant's login policy/IdP list, and the signup register path resolving new users into the wrong default org id.

**Suggested fix:** Key the memo by the provider's service URL (e.g. a Map<serviceUrl, string> — expose serviceUrl on AuthProvider or pass it in), or move the memo onto the provider instance itself. Also consider a TTL so a changed instance Default Organization doesn't require a process restart.

---

## 29. [MEDIUM] Device-tracking token permanently lost when MaxMind cookie lands after the 6s poll budget — reader never falls back to the cookie
**File:** `app/modules/fraud/maxmind-tracker.tsx:63`  | votes 3/3 | race-condition

**Defect:** MaxMindTracker polls the __mmapiwsid cookie 30 times at 200ms and then gives up forever (line 63). readMaxMindTrackingToken() (lines 73-80) reads ONLY the sessionStorage mirror and never falls back to reading the cookie directly, even though readMaxMindCookie() exists in the same file. Every consumer depends solely on the mirror: app/routes/signup/index.tsx and app/routes/signup/password.tsx run an UNBOUNDED 300ms interval calling readMaxMindTrackingToken() 'until it appears', and app/components/auth-form/idp-button-list.tsx reads it once post-mount. Once the tracker's 6s budget expires, the mirror can never be populated for that page view, so the consumers' expectation ('the token may land a moment after mount, re-read until it appears') is unsatisfiable — the route-level intervals spin forever and the hidden deviceTrackingToken field stays empty.

**Failure scenario:** User on a slow/high-latency connection (or with device.js briefly delayed) opens /signup. device.js finishes its fingerprint exchange and writes __mmapiwsid at t=8s — after the tracker stopped polling at t≈6s. The token exists in document.cookie but is never mirrored to sessionStorage. The user submits signup at t=30s: the hidden deviceTrackingToken input is empty, the Zitadel session is created without the 'maxmind/tracking-token' metadata, and the fraud pipeline gets no device fingerprint for exactly the traffic (slow proxies, Tor, throttled bots) it most needs to score. The failure is completely silent — no log, no retry.

**Suggested fix:** Make readMaxMindTrackingToken() fall back to readMaxMindCookie() when sessionStorage has no mirrored token (and mirror it on that read), or remove the MAX_POLL_ATTEMPTS hard stop so the interval keeps polling until unmount (it is already cleared in the effect cleanup).

---

## 30. [MEDIUM] Verify resend action: provider failure rethrows uncaught to a 500, and the un-gated userId makes the 500/200 split a user-enumeration oracle
**File:** `app/routes/verify/index.tsx:101`  | votes 3/3 | error-handling

**Defect:** The action's `intent === 'resend'` branch awaits `resendEmailCode(provider, { userId: parsed.data.userId, … })` bare. resendEmailCode (app/resources/verify/verify.service.ts:132-148) maps only ALREADY_DONE to a typed result and rethrows every other ProviderError (NOT_FOUND for a nonexistent userId, UNAVAILABLE, …), so the action 500s to the root ErrorBoundary instead of returning a friendly 400 like every other branch in this route. Unlike the loader's ?send=true dispatch — which was explicitly hardened with a session-ownership gate (dispatchEmailCode) plus the verifyEmailSendRateLimit middleware that self-guards on GET+?send=true only — the POST resend path takes userId straight from a client-controlled hidden field with no ownership gate and no rate limit, so the differing outcomes are observable to an attacker.

**Failure scenario:** POST /id/verify with intent=resend, code=resend and a syntactically valid but nonexistent userId (CSRF pair freely obtained from the GET): Zitadel resendEmailCode throws ProviderError('NOT_FOUND') → uncaught → 500 error page + Sentry noise. With a real userId of any unverified account the same POST returns 200 CODE_SENT and emails that account — the 500-vs-200 split confirms which userIds exist, and repeated POSTs flood arbitrary users' inboxes since verifyEmailSendRateLimit does not cover POST.

**Suggested fix:** Wrap the resendEmailCode call in try/catch mapping ProviderError to a generic 200 CODE_SENT (enumeration-safe, mirroring the signup pattern) or a 400; additionally apply the same session-ownership gate the loader dispatch uses and extend the rate limiter to the POST resend path.

---

## 31. [MEDIUM] setupSkipSchema.parse (not safeParse) on user-controlled query params in three loaders — tampered ?force=/…?checkAfter= throws ZodError → 500
**File:** `app/resources/webauthn/webauthn-enroll.ts:153`  | votes 2/2 | validation

**Defect:** Three loaders run `setupSkipSchema.parse(Object.fromEntries(url.searchParams))` on raw query params: webauthn-enroll.ts:153 (shared by /setup/passkey and /setup/security-key), app/routes/setup/mfa.tsx:89, and app/routes/setup/authenticator.tsx:34. setupSkipSchema requires force/checkAfter ∈ {'true','false'} when present, so any other value throws an uncaught ZodError in the loader → root ErrorBoundary 500. The parallel factory otp-enroll.ts:108-111 was deliberately fixed to safeParse with the comment "Never throw a 500 on tampered query params… an invalid value degrades to undefined" — these three sites were left behind. In authenticator.tsx and mfa.tsx the parse runs before the session guard, so the 500 is triggerable unauthenticated.

**Failure scenario:** GET /id/setup/mfa?loginName=x&force=1 (or ?checkAfter=yes, or a mangled email link rewritten by a tracking proxy) → ZodError thrown in the loader → generic 500 error page, where the sibling /setup/email and /setup/sms routes gracefully degrade the same input to undefined and render normally.

**Suggested fix:** Replace .parse with the otp-enroll.ts pattern at all three sites: `const skip = setupSkipSchema.safeParse(...); const { force, checkAfter } = skip.success ? skip.data : {};`.

---
