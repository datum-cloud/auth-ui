/**
 * Auth-event audit coverage test.
 *
 * TWO guarantees are checked here:
 *
 * 1. ROUTE COVERAGE — every route file that exports an `action` function must
 *    contain at least one `logAuthEvent(` call, either inline or in the _shared
 *    factory it delegates to.  This is a cheap, static-analysis-style proxy that
 *    catches future actions added without audit.
 *
 * 2. EVENT-NAME REGISTRY — a canonical set of event names (the "frozen inventory")
 *    must each appear as a string literal argument to a `logAuthEvent(` call site
 *    somewhere in the app/routes tree.  This pins against silent renames that
 *    would break Prometheus dashboards and alerts (which regex-match event names
 *    directly, e.g. `password_check|ldap_signin|idp\.signin`).
 *
 * CONVENTION NOTE (frozen as-is):
 *   Phase 4 events: dot-case  (e.g. idp.signin, password.change)
 *   Phase 5+ events: snake_case (e.g. password_check, mfa_enroll)
 *   New events must use snake_case.  Do NOT mass-rename existing events — doing
 *   so silently breaks P4-era audit history and the alert regexes above.
 *
 * EXCUSED ROUTES (actions that are intentionally navigational / audit-free):
 *   - None currently.  All auth-action routes emit logAuthEvent through either
 *     their own body or a _shared factory (_shared/otp-enroll.ts,
 *     _shared/webauthn-verify.ts) that they delegate to entirely.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROUTES_DIR = join(__dirname, '../../../routes');
const RESOURCES_DIR = join(__dirname, '../../../resources');

// Shared action factories formerly under routes/_shared/, now distributed into
// the resources/ layer. Keyed by their original basename so the delegation and
// registry checks below keep working against the new locations.
const SHARED_FACTORY_PATHS: Record<string, string> = {
  'otp-enroll.ts': join(RESOURCES_DIR, 'otp/otp-enroll.ts'),
  'webauthn-verify.ts': join(RESOURCES_DIR, 'webauthn/webauthn-verify.ts'),
  // Pass 2: password routes delegate their action logic (incl. logAuthEvent) to the
  // password domain service. Registered here so the delegation + registry checks
  // resolve the password.* events at their new call site.
  'password.service.ts': join(RESOURCES_DIR, 'password/password.service.ts'),
  // Pass 2: the signup routes (index + password) delegate their action logic (incl.
  // logAuthEvent) to the signup domain service. Registered here so the delegation +
  // registry checks resolve the signup.* events at their new call site.
  'signup.service.ts': join(RESOURCES_DIR, 'signup/signup.service.ts'),
  // Pass 2: the verify route (verify/index.tsx) delegates its action logic (incl.
  // logAuthEvent for email.verified / invite.verified) to the verify domain service.
  // Registered here so the delegation + registry checks resolve those events at their
  // new call site in resources/verify/verify.service.ts.
  'verify.service.ts': join(RESOURCES_DIR, 'verify/verify.service.ts'),
  // Pass 2: the OTP verify routes (login/verify/{email,sms,authenticator}.tsx) and the
  // setup/authenticator.tsx route delegate their loader/action logic (incl. the
  // mfa_otp / mfa_otp_challenge / mfa_totp / mfa_enroll logAuthEvent calls) to the otp
  // domain service. Registered here so the delegation + registry checks resolve those
  // events at their new call site in resources/otp/otp.service.ts.
  'otp.service.ts': join(RESOURCES_DIR, 'otp/otp.service.ts'),
  // Pass 2: the mfa routes (login/mfa.tsx chooser + setup/mfa.tsx skip) delegate their
  // loader/action logic (incl. the mfa_method_chosen / mfa_skip logAuthEvent calls) to the
  // mfa domain service. Registered here so the delegation + registry checks resolve those
  // events at their new call site in resources/mfa/mfa.service.ts.
  'mfa.service.ts': join(RESOURCES_DIR, 'mfa/mfa.service.ts'),
  // Pass 2: the webauthn setup routes (setup/passkey.tsx + setup/security-key.tsx) delegate
  // their loader/action logic (incl. the mfa_enroll / mfa_enroll_challenge logAuthEvent calls)
  // to the webauthn domain service. The login verify routes still delegate to the
  // webauthn-verify factory above. Registered here so the delegation + registry checks resolve
  // those events at their new call site in resources/webauthn/webauthn.service.ts.
  'webauthn.service.ts': join(RESOURCES_DIR, 'webauthn/webauthn.service.ts'),
  // Pass 2: the authorize route (authorize/index.tsx) delegates its entire loader logic (incl.
  // the session_stale / oidc_callback / authrequest_resolve logAuthEvent calls) to the authorize
  // domain service. The route is now a thin provider→resolveAuthorize→outcomeToResponse
  // translator. Registered here so the delegation + registry checks resolve those events at their
  // new call site in resources/authorize/authorize.service.ts.
  'authorize.service.ts': join(RESOURCES_DIR, 'authorize/authorize.service.ts'),
  // Pass 2: the device routes (device/index.tsx + device/authorize.tsx) delegate their action
  // logic (incl. the device_code_lookup / device_authorize logAuthEvent calls) to the device
  // domain service. The routes are now thin provider→service→*OutcomeToResponse translators.
  // Registered here so the delegation + registry checks resolve those events at their new call
  // site in resources/device/device.service.ts.
  'device.service.ts': join(RESOURCES_DIR, 'device/device.service.ts'),
  // Pass 2: the session-surface routes (accounts.tsx switch/remove action, logout/index.tsx
  // action, and the signed-in.tsx loader's post_login_* events) delegate their business logic
  // (incl. the account_switch / account_remove / logout / post_login_* logAuthEvent calls) to the
  // session domain service. The routes are now thin provider→service→*OutcomeToResponse
  // translators. Registered here so the delegation + registry checks resolve those events at their
  // new call site in resources/session/session.service.ts.
  'session.service.ts': join(RESOURCES_DIR, 'session/session.service.ts'),
  // Pass 2: the SSO routes (sso/index.tsx loader+action, sso/ldap.tsx action, and the
  // sso/provider/callback.tsx loader) delegate their business logic (incl. the idp_start /
  // idp.signin / idp.link / idp.link.denied / idp.link.start / idp.unlink / ldap_signin
  // logAuthEvent calls) to the sso domain service. The routes are now thin
  // provider→service→outcomeToResponse translators. Registered here so the delegation +
  // registry checks resolve those events at their new call site in resources/sso/sso.service.ts.
  'sso.service.ts': join(RESOURCES_DIR, 'sso/sso.service.ts'),
  // Pass 2: the login routes (login/index.tsx loader+action and login/password.tsx action)
  // delegate their business logic (incl. the identifier / idp_start / password_check
  // logAuthEvent calls) to the login domain service. The routes are now thin
  // provider→service→redirect/data translators. Registered here so the delegation + registry
  // checks resolve those events at their new call site in resources/login/login.service.ts.
  'login.service.ts': join(RESOURCES_DIR, 'login/login.service.ts'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

/**
 * Recursively collect every route module under routes/, skipping __tests__
 * folders and any underscore-prefixed entry (legacy _shared/_schemas dirs).
 * Routes are now nested by domain (routes/<domain>/<file>.tsx), so a flat
 * readdir would miss everything below the top level.
 */
function routeFiles(): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === '__tests__') {
        continue; // skip _shared/_schemas legacy dirs and test folders
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.test.tsx')
      ) {
        out.push(full);
      }
    }
  }

  walk(ROUTES_DIR);
  return out;
}

/** Path of a route module relative to ROUTES_DIR, e.g. `setup/email.tsx`. */
function routeKey(filePath: string): string {
  return relative(ROUTES_DIR, filePath);
}

function sharedFiles(): string[] {
  return Object.values(SHARED_FACTORY_PATHS);
}

/** All text across routes/ and routes/_shared/ concatenated — for registry check. */
function allRouteText(): string {
  const routeText = routeFiles().map(readFile).join('\n');
  const sharedText = sharedFiles().map(readFile).join('\n');
  return routeText + '\n' + sharedText;
}

// ---------------------------------------------------------------------------
// Route-coverage check
// ---------------------------------------------------------------------------

/**
 * Routes that delegate their entire action logic to a _shared factory that
 * contains logAuthEvent internally.  We mark them here so the test knows to
 * look at the factory file rather than the route file itself.
 *
 * Mapping: route path (relative to routes/) → the _shared file(s) that cover it.
 */
const DELEGATED_TO_SHARED: Record<string, string[]> = {
  // setup/email and setup/sms delegate to the otp-enroll factory (now resources/otp)
  'setup/email.tsx': ['otp-enroll.ts'],
  'setup/sms.tsx': ['otp-enroll.ts'],
  // login/passkey and login/security-key delegate to the webauthn-verify factory, which (Pass 2)
  // now delegates its audited assertion logic (mfa_passkey* / mfa_u2f* logAuthEvent calls) to the
  // webauthn domain service. Both files cover the delegation.
  'login/passkey.tsx': ['webauthn-verify.ts', 'webauthn.service.ts'],
  'login/security-key.tsx': ['webauthn-verify.ts', 'webauthn.service.ts'],
  // Pass 2: the password routes are thin — their action logic (and logAuthEvent calls)
  // lives in resources/password/password.service.ts.
  'password/reset.tsx': ['password.service.ts'],
  'password/new.tsx': ['password.service.ts'],
  'password/change.tsx': ['password.service.ts'],
  // Pass 2: the signup routes are thin — their action logic (and logAuthEvent calls)
  // lives in resources/signup/signup.service.ts.
  'signup/index.tsx': ['signup.service.ts'],
  'signup/password.tsx': ['signup.service.ts'],
  'signup/method.tsx': ['signup.service.ts'],
  // Pass 2: the verify route is thin — its action logic (and the email.verified /
  // invite.verified logAuthEvent calls) lives in resources/verify/verify.service.ts.
  'verify/index.tsx': ['verify.service.ts'],
  // Pass 2: the OTP verify routes are thin — their action logic (and the mfa_otp /
  // mfa_otp_challenge / mfa_totp logAuthEvent calls) lives in resources/otp/otp.service.ts.
  'login/verify/email.tsx': ['otp.service.ts'],
  'login/verify/sms.tsx': ['otp.service.ts'],
  'login/verify/authenticator.tsx': ['otp.service.ts'],
  // setup/authenticator.tsx delegates its TOTP-enroll action (mfa_enroll) to the otp service.
  'setup/authenticator.tsx': ['otp.service.ts'],
  // Pass 2: the mfa routes are thin — their action logic (and the mfa_method_chosen /
  // mfa_skip logAuthEvent calls) lives in resources/mfa/mfa.service.ts.
  'login/mfa.tsx': ['mfa.service.ts'],
  'setup/mfa.tsx': ['mfa.service.ts'],
  // Pass 2: the webauthn setup routes are thin — their action logic (and the mfa_enroll /
  // mfa_enroll_challenge logAuthEvent calls) lives in resources/webauthn/webauthn.service.ts.
  'setup/passkey.tsx': ['webauthn.service.ts'],
  'setup/security-key.tsx': ['webauthn.service.ts'],
  // Pass 2: the device routes are thin — their action logic (and the device_code_lookup /
  // device_authorize logAuthEvent calls) lives in resources/device/device.service.ts.
  'device/index.tsx': ['device.service.ts'],
  'device/authorize.tsx': ['device.service.ts'],
  // Pass 2: the session-surface routes are thin — their action logic (and the account_switch /
  // account_remove logAuthEvent calls for accounts.tsx, and the logout logAuthEvent call for
  // logout/index.tsx) lives in resources/session/session.service.ts.
  'accounts.tsx': ['session.service.ts'],
  'logout/index.tsx': ['session.service.ts'],
  // Pass 2: the SSO routes are thin — their action logic (and the idp_start / idp.unlink
  // logAuthEvent calls for sso/index.tsx, and the ldap_signin logAuthEvent calls for
  // sso/ldap.tsx) lives in resources/sso/sso.service.ts.
  'sso/index.tsx': ['sso.service.ts'],
  'sso/ldap.tsx': ['sso.service.ts'],
  // Pass 2: the login routes are thin — their action logic (and the identifier / idp_start
  // logAuthEvent calls for login/index.tsx, and the password_check logAuthEvent calls for
  // login/password.tsx) lives in resources/login/login.service.ts.
  'login/index.tsx': ['login.service.ts'],
  'login/password.tsx': ['login.service.ts'],
};

/**
 * Routes whose action is purely navigational and does not perform an
 * authentication operation that requires an audit trail.
 * Each entry must have a documented reason.
 */
const EXCUSED_ACTIONS: Record<string, string> = {
  // Currently empty — all action routes are audited.
};

describe('Auth-event audit: route coverage', () => {
  const files = routeFiles();

  files.forEach((filePath) => {
    const key = routeKey(filePath);
    const content = readFile(filePath);

    if (
      !content.includes('export') ||
      !content.match(/export\s+(async\s+)?function\s+action|export\s+const\s+action/)
    ) {
      // No action export — skip.
      return;
    }

    it(`${key} action has logAuthEvent coverage`, () => {
      if (EXCUSED_ACTIONS[key]) {
        // Excused: document the reason so a reviewer sees it.
        console.log(`[excused] ${key}: ${EXCUSED_ACTIONS[key]}`);
        return;
      }

      const delegated = DELEGATED_TO_SHARED[key];
      if (delegated) {
        // Must find logAuthEvent in the delegated _shared file(s).
        const sharedCovered = delegated.some((sharedFile) => {
          const sharedPath = SHARED_FACTORY_PATHS[sharedFile] ?? join(RESOURCES_DIR, sharedFile);
          const sharedContent = readFile(sharedPath);
          return sharedContent.includes('logAuthEvent(');
        });
        expect(
          sharedCovered,
          `${key} delegates to ${delegated.join(', ')} but none of those contain logAuthEvent(`
        ).toBe(true);
        return;
      }

      // Direct check: the route file itself must contain logAuthEvent(.
      expect(
        content.includes('logAuthEvent('),
        `${key} exports an action but contains no logAuthEvent( call — ` +
          `add audit coverage or add it to DELEGATED_TO_SHARED / EXCUSED_ACTIONS`
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Event-name registry
// ---------------------------------------------------------------------------

/**
 * Canonical event-name inventory.
 *
 * Convention (FROZEN — do not mass-rename):
 *   P4 era: dot-case  → idp.*, password.*
 *   P5+ era: snake_case → password_check, mfa_*, passkey_*, …
 *   New events must use snake_case.
 *
 * The three names pinned for Prometheus alert-rule compatibility:
 *   password_check | ldap_signin | idp\.signin
 * These MUST remain in the registry and at their exact call sites.
 */
export const REQUIRED_EVENTS = [
  // --- Prometheus alert-rule pinned (do NOT rename) ---
  'password_check',
  'ldap_signin',
  'idp.signin',
  // --- Identifier / IdP start ---
  'identifier',
  'idp_start',
  // --- IdP callback / linking ---
  'idp.link',
  'idp.link.denied',
  'idp.link.start',
  'idp.unlink',
  // --- MFA methods ---
  'mfa_method_chosen',
  'mfa_totp',
  'mfa_otp_challenge',
  'mfa_otp',
  'mfa_enroll',
  'mfa_enroll_challenge',
  'mfa_skip',
  // --- WebAuthn (emitted via cfg.auditEvent / cfg.challengeAuditEvent in login.passkey.tsx /
  //     login.security-key.tsx; the factory is _shared/webauthn-verify.ts) ---
  'mfa_passkey',
  'mfa_u2f',
  'mfa_passkey_challenge',
  'mfa_u2f_challenge',
  // --- Account management ---
  'account_switch',
  'account_remove',
  // --- Authorization flows ---
  'authrequest_resolve',
  'oidc_callback',
  // session_stale: emitted by app/routes/authorize.tsx when a reused `sessions` cookie entry
  // points at a terminated/invalid Zitadel session (the post-logout stale-cookie case). The
  // /authorize loader validates liveness via getSession before createCallback and self-heals
  // by dropping the stale entry + re-prompting /login. Distinct from oidc_callback failure so
  // the self-heal is traceable and never confused with a genuine ALREADY_DONE on a live session.
  'session_stale',
  'saml_response',
  'device_code_lookup',
  'device_authorize',
  // --- Session ---
  'logout',
  // --- Password ---
  'password.change',
  'password.reset.completed',
  'password.reset.requested',
  // --- Registration / verification ---
  'signup.requested',
  'signup.created',
  'email.verified',
  'invite.verified',
  // --- Rate limiting (emitted by middleware, not routes — present in observability layer) ---
  'rate_limit',
  // --- Session layer (P7 Task 8 Step 8 tamper guard, emitted by app/session/cookie.ts) ---
  'session_cookie',
  // --- signed-in degraded-path audit (CODE-MAJ-05) ---
  'post_login_settings',
  'post_login_admin_check',
] as const;

describe('Auth-event audit: event-name registry', () => {
  const all = allRouteText();

  it('every REQUIRED_EVENTS name is actually emitted by a route (CODE-MIN-15)', () => {
    // Events excused from the literal-string-presence check because they are assembled
    // dynamically (e.g. passed as cfg values) or emitted outside the routes layer.
    // Keep this in sync with DYNAMIC_OR_EXTERNAL below.
    const EXCUSED_FROM_LITERAL_CHECK = [
      // WebAuthn: cfg.auditEvent is passed as a string value in login.passkey.tsx /
      // login.security-key.tsx and forwarded to logAuthEvent via the factory —
      // the string 'mfa_passkey' / 'mfa_u2f' does NOT sit directly at a logAuthEvent( call.
      'mfa_passkey',
      'mfa_u2f',
      // Emitted outside the routes layer:
      'saml_response',
      'rate_limit',
      'session_cookie',
    ];
    const missing = REQUIRED_EVENTS.filter(
      (e) => !EXCUSED_FROM_LITERAL_CHECK.includes(e) && !all.includes(`'${e}'`)
    );
    expect(missing, `REQUIRED_EVENTS not emitted anywhere: ${missing.join(', ')}`).toEqual([]);
  });

  /**
   * Events whose names never appear as a raw string literal in route files
   * because they are assembled dynamically or live outside the routes layer.
   *
   * Each excused event must have a documented reason.
   */
  const DYNAMIC_OR_EXTERNAL: Record<string, string> = {
    // CODE-MIN-15: WebAuthn audit event names are now aligned with the runtime values.
    // cfg.auditEvent is set to 'mfa_passkey' / 'mfa_u2f' in login.passkey.tsx /
    // login.security-key.tsx and forwarded dynamically to logAuthEvent via the
    // _shared/webauthn-verify.ts factory — the string never sits directly at logAuthEvent(.
    // mfa_passkey_challenge / mfa_u2f_challenge appear as literal cfg.challengeAuditEvent
    // values in the route files and ARE found by the static check, so they are not excused.
    mfa_passkey: 'emitted as cfg.auditEvent = "mfa_passkey" in login.passkey.tsx (dynamic)',
    mfa_u2f: 'emitted as cfg.auditEvent = "mfa_u2f" in login.security-key.tsx (dynamic)',
    mfa_passkey_challenge:
      'emitted as cfg.challengeAuditEvent in webauthn-verify.ts (config value in login.passkey.tsx)',
    mfa_u2f_challenge:
      'emitted as cfg.challengeAuditEvent in webauthn-verify.ts (config value in login.security-key.tsx)',
    // Pass 2: the OTP verify ceremony (login/verify/{email,sms,authenticator}.tsx) delegates to
    // resources/otp/otp.service.ts, where mfa_otp / mfa_totp are emitted via the per-channel
    // VERIFY_CHANNELS config (logAuthEvent(cfg.successEvent, …) / logAuthEvent(cfg.failureEvent, …)).
    // The literal sits in the config object, not directly at the logAuthEvent( call — same dynamic
    // pattern as mfa_passkey / mfa_u2f above. Both names still appear as literals in the service
    // file, so the CODE-MIN-15 "emitted anywhere" check still covers them.
    mfa_otp:
      'emitted via cfg.successEvent/cfg.failureEvent = "mfa_otp" in otp.service.ts (dynamic)',
    mfa_totp:
      'emitted via cfg.successEvent/cfg.failureEvent = "mfa_totp" in otp.service.ts (dynamic)',
    // saml_response is now emitted by the stateless SAML BFF handler — the response is
    // generated inside app/server/routes/saml-post.ts (the server layer), not in /authorize,
    // so the assertion never crosses a request boundary (replicas-safe). authrequest_resolve
    // still appears in app/routes/authorize.tsx (and saml-post.ts), so it stays covered here.
    saml_response: 'emitted by app/server/routes/saml-post.ts BFF handler (not in app/routes/)',
    // rate_limit is emitted by the rate-limiting middleware, not by route files.
    rate_limit: 'emitted by server middleware layer (not in app/routes/)',
    // session_cookie tamper signal is emitted by the session layer (P7 Task 8 Step 8 guard).
    session_cookie: 'emitted by app/session/cookie.ts readSessions guard (not in app/routes/)',
  };

  REQUIRED_EVENTS.forEach((eventName) => {
    it(`event '${eventName}' appears at a logAuthEvent call site`, () => {
      if (DYNAMIC_OR_EXTERNAL[eventName]) {
        console.log(`[excused] ${eventName}: ${DYNAMIC_OR_EXTERNAL[eventName]}`);
        return;
      }

      // The event name must appear as a string literal on a line that also contains
      // logAuthEvent(.  This handles both the common case:
      //   logAuthEvent('foo', ...)
      // and ternary forms:
      //   logAuthEvent(cond ? 'foo' : 'bar', ...)
      // where the name doesn't sit immediately after the opening paren.
      const quotedName = `['"\`]${escapeRegex(eventName)}['"\`]`;
      const directPattern = new RegExp(`logAuthEvent\\s*\\(\\s*${quotedName}`);
      const ternaryPattern = new RegExp(`logAuthEvent\\([^)]*${quotedName}`);
      const found = directPattern.test(all) || ternaryPattern.test(all);
      expect(
        found,
        `event '${eventName}' is in REQUIRED_EVENTS but not found at any logAuthEvent( call site. ` +
          `Either add the call, fix a rename, or move the event to DYNAMIC_OR_EXTERNAL with a reason.`
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// PII guard — CCD-9
// ---------------------------------------------------------------------------

describe('Auth-event audit: PII guard', () => {
  it('no logAuthEvent call passes a raw loginName or email field (CCD-9)', () => {
    // ROUTE_FILES / readFileSync pattern already established earlier in this test file.
    const offenders: string[] = [];
    for (const file of routeFiles()) {
      const src = readFile(file);
      // any logAuthEvent(...) whose argument text contains a bare loginName: or email: object
      // key. hashActor(loginName) is fine — it's a call expression, not an object key.
      const calls = src.match(/logAuthEvent\([\s\S]*?\)\s*;/g) ?? [];
      for (const call of calls) {
        if (/[\s{,]loginName\s*:/.test(call) || /[\s{,]email\s*:/.test(call)) {
          offenders.push(`${file}: ${call.slice(0, 80)}…`);
        }
      }
    }
    expect(offenders, `raw PII in audit fields:\n${offenders.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
