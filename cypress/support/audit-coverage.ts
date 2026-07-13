/**
 * Auth-event audit coverage scanner — Node-side module for the cy.task harness.
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
 *
 * This module is registered as the `auditCoverage` cy.task in the e2e project's
 * setupNodeEvents and returns structured results for assertion in the spec.
 * It CANNOT run in a browser — all logic runs in Node.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RouteCoverageEntry {
  key: string;
  ok: boolean;
  reason?: string;
}

export interface AuditCoverageResult {
  routeCoverage: RouteCoverageEntry[];
  missingEvents: string[];
  piiOffenders: string[];
}

// ---------------------------------------------------------------------------
// Paths — resolved from process.cwd() because __dirname differs under Cypress
// ---------------------------------------------------------------------------

const ROUTES_DIR = join(process.cwd(), 'app/routes');
const RESOURCES_DIR = join(process.cwd(), 'app/resources');
const MIDDLEWARE_DIR = join(process.cwd(), 'app/server/middleware');

// Shared action factories formerly under routes/_shared/, now distributed into
// the resources/ layer. Keyed by their original basename so the delegation and
// registry checks below keep working against the new locations.
//
// A value may be a single file path or an array of file paths. The array form
// is used when a domain's audited logic was decomposed into several cohesive
// sibling modules (sso.service.ts is now a thin barrel re-export — the
// logAuthEvent calls live in the cohesive modules it composes), so the
// delegation + registry checks must scan every module that holds a call site.
const SHARED_FACTORY_PATHS: Record<string, string | string[]> = {
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
  // new call site in resources/session/session.service.ts. The /logout slice (its `logout`
  // logAuthEvent calls) was extracted to session-logout.service.ts (re-exported by
  // session.service.ts), so both modules are registered.
  'session.service.ts': [
    join(RESOURCES_DIR, 'session/session.service.ts'),
    join(RESOURCES_DIR, 'session/session-logout.service.ts'),
  ],
  // Pass 2: the SSO routes (sso/index.tsx loader+action, sso/ldap.tsx action, and the
  // sso/provider/callback.tsx loader) delegate their business logic (incl. the idp_start /
  // idp.signin / idp.link / idp.link.denied / idp.link.start / idp.unlink / ldap_signin
  // logAuthEvent calls) to the sso domain service. The routes are now thin
  // provider→service→outcomeToResponse translators. The decomposition split sso.service.ts into
  // cohesive sibling modules (sso.service.ts is now a thin barrel re-export with no call sites);
  // the logAuthEvent calls live in sso-action.ts (idp_start / idp.unlink), sso-callback.ts
  // (idp.signin / idp.link / idp.link.denied), sso-link.ts (idp.link.start), and sso-ldap.ts
  // (ldap_signin). All four are registered so the delegation + registry checks resolve the
  // sso events at their new call sites.
  'sso.service.ts': [
    join(RESOURCES_DIR, 'sso/sso-action.ts'),
    join(RESOURCES_DIR, 'sso/sso-callback.ts'),
    join(RESOURCES_DIR, 'sso/sso-link.ts'),
    join(RESOURCES_DIR, 'sso/sso-ldap.ts'),
  ],
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

/** Non-route source files that also emit logAuthEvent (middleware + domain services). */
function auditedNonRouteFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, pick: (name: string) => boolean): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, pick);
      else if (pick(entry.name)) out.push(full);
    }
  };
  walk(MIDDLEWARE_DIR, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
  walk(RESOURCES_DIR, (n) => n.endsWith('.service.ts') && !n.endsWith('.test.ts'));
  return out;
}

/** Every file the PII guard must scan: routes + middleware + domain services. */
function piiGuardFiles(): string[] {
  return [...routeFiles(), ...auditedNonRouteFiles()];
}

function sharedFiles(): string[] {
  return Object.values(SHARED_FACTORY_PATHS).flat();
}

/** All text across routes/ and routes/_shared/ concatenated — for registry check. */
function allRouteText(): string {
  const routeText = routeFiles().map(readFile).join('\n');
  const sharedText = sharedFiles().map(readFile).join('\n');
  return routeText + '\n' + sharedText;
}

// ---------------------------------------------------------------------------
// Route-coverage check configuration
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
  // Diagnostic decision-trace for the explicit link ceremony (PII-safe booleans; snake_case
  // per the P5+ convention). Emitted in sso-callback.ts to explain link access-denied outcomes.
  'idp_link_decision',
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
  // --- signed-in degraded-path audit ---
  'post_login_settings',
  'post_login_admin_check',
] as const;

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Main exported scanner
// ---------------------------------------------------------------------------

/**
 * Run the full auth-event audit coverage scan and return structured results.
 * All three checks run (route coverage, event-name registry, PII guard).
 * Callers assert on the returned object — no `expect` calls inside.
 */
export function runAuditCoverage(): AuditCoverageResult {
  // ---- 1. Route coverage -----------------------------------------------
  const routeCoverage: RouteCoverageEntry[] = [];
  const files = routeFiles();

  for (const filePath of files) {
    const key = routeKey(filePath);
    const content = readFile(filePath);

    if (
      !content.includes('export') ||
      !content.match(/export\s+(async\s+)?function\s+action|export\s+const\s+action/)
    ) {
      // No action export — skip.
      continue;
    }

    if (EXCUSED_ACTIONS[key]) {
      routeCoverage.push({ key, ok: true, reason: `excused: ${EXCUSED_ACTIONS[key]}` });
      continue;
    }

    const delegated = DELEGATED_TO_SHARED[key];
    if (delegated) {
      const sharedCovered = delegated.some((sharedFile) => {
        const mapped = SHARED_FACTORY_PATHS[sharedFile] ?? join(RESOURCES_DIR, sharedFile);
        const paths = Array.isArray(mapped) ? mapped : [mapped];
        return paths.some((p) => readFile(p).includes('logAuthEvent('));
      });
      if (sharedCovered) {
        routeCoverage.push({ key, ok: true });
      } else {
        routeCoverage.push({
          key,
          ok: false,
          reason: `${key} delegates to ${delegated.join(', ')} but none of those contain logAuthEvent(`,
        });
      }
      continue;
    }

    // Direct check: the route file itself must contain logAuthEvent(.
    if (content.includes('logAuthEvent(')) {
      routeCoverage.push({ key, ok: true });
    } else {
      routeCoverage.push({
        key,
        ok: false,
        reason:
          `${key} exports an action but contains no logAuthEvent( call — ` +
          `add audit coverage or add it to DELEGATED_TO_SHARED / EXCUSED_ACTIONS`,
      });
    }
  }

  // ---- 2. Event-name registry ------------------------------------------
  const all = allRouteText();

  // Events excused from the literal-string-presence check because they do not
  // appear as quoted string literals in the routes/resources layer at all.
  // (They are assembled dynamically or emitted entirely outside the routes layer.)
  const EXCUSED_FROM_LITERAL_CHECK: string[] = [
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

  // Events excused from the strict "must appear AT a logAuthEvent( call site" regex
  // check because they are assembled dynamically (passed as cfg values) but DO still
  // appear as string literals somewhere in the codebase (so they pass the basic
  // literal-presence check above). Keep this in sync with the source comments.
  const EXCUSED_FROM_CALLSITE_CHECK: string[] = [
    // WebAuthn: same as EXCUSED_FROM_LITERAL_CHECK — never at a logAuthEvent( call site.
    'mfa_passkey',
    'mfa_u2f',
    // cfg.challengeAuditEvent values in login.passkey.tsx / login.security-key.tsx —
    // they appear as string literals in the route config objects but not at logAuthEvent(.
    'mfa_passkey_challenge',
    'mfa_u2f_challenge',
    // otp.service.ts emits these via cfg.successEvent / cfg.failureEvent config objects.
    // Both names appear as literals in otp.service.ts so the literal check still covers them.
    'mfa_otp',
    'mfa_totp',
    // Emitted outside the routes layer (no logAuthEvent call site in scanned files).
    'saml_response',
    'rate_limit',
    'session_cookie',
  ];

  const missingEvents: string[] = [];

  for (const eventName of REQUIRED_EVENTS) {
    // Check 1 — literal-string presence: event name must appear as a quoted string
    // literal somewhere in the combined routes + shared text.
    if (!EXCUSED_FROM_LITERAL_CHECK.includes(eventName) && !all.includes(`'${eventName}'`)) {
      missingEvents.push(eventName);
      continue; // no point doing the call-site check if the literal isn't even there
    }

    // Check 2 — call-site presence: event name must appear at a logAuthEvent( call.
    // This handles both the common case:
    //   logAuthEvent('foo', ...)
    // and ternary forms:
    //   logAuthEvent(cond ? 'foo' : 'bar', ...)
    if (!EXCUSED_FROM_CALLSITE_CHECK.includes(eventName)) {
      const quotedName = `['"\`]${escapeRegex(eventName)}['"\`]`;
      const directPattern = new RegExp(`logAuthEvent\\s*\\(\\s*${quotedName}`);
      const ternaryPattern = new RegExp(`logAuthEvent\\([^)]*${quotedName}`);
      const found = directPattern.test(all) || ternaryPattern.test(all);
      if (!found) {
        missingEvents.push(eventName);
      }
    }
  }

  // ---- 3. PII guard ----------------------------------------------------
  const piiOffenders: string[] = [];
  for (const file of piiGuardFiles()) {
    const src = readFile(file);
    // any logAuthEvent(...) whose argument text contains a bare loginName: or email: object
    // key. hashActor(loginName) is fine — it's a call expression, not an object key.
    const calls = src.match(/logAuthEvent\([\s\S]*?\)\s*;/g) ?? [];
    for (const call of calls) {
      if (/[\s{,]loginName\s*:/.test(call) || /[\s{,]email\s*:/.test(call)) {
        piiOffenders.push(`${file}: ${call.slice(0, 80)}…`);
      }
    }
  }

  return { routeCoverage, missingEvents, piiOffenders };
}
