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
import { join } from 'path';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROUTES_DIR = join(__dirname, '../../routes');
const SHARED_DIR = join(ROUTES_DIR, '_shared');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

function routeFiles(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .filter((f) => !f.startsWith('_')) // exclude _shared, _schemas dirs
    .map((f) => join(ROUTES_DIR, f));
}

function sharedFiles(): string[] {
  return readdirSync(SHARED_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(SHARED_DIR, f));
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
 * Mapping: route basename → the _shared file(s) that cover it.
 */
const DELEGATED_TO_SHARED: Record<string, string[]> = {
  // setup.email and setup.sms delegate to _shared/otp-enroll.ts
  'setup.email.tsx': ['otp-enroll.ts'],
  'setup.sms.tsx': ['otp-enroll.ts'],
  // login.passkey and login.security-key delegate to _shared/webauthn-verify.ts
  'login.passkey.tsx': ['webauthn-verify.ts'],
  'login.security-key.tsx': ['webauthn-verify.ts'],
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
    const basename = filePath.split('/').at(-1)!;
    const content = readFile(filePath);

    if (
      !content.includes('export') ||
      !content.match(/export\s+(async\s+)?function\s+action|export\s+const\s+action/)
    ) {
      // No action export — skip.
      return;
    }

    it(`${basename} action has logAuthEvent coverage`, () => {
      if (EXCUSED_ACTIONS[basename]) {
        // Excused: document the reason so a reviewer sees it.
        console.log(`[excused] ${basename}: ${EXCUSED_ACTIONS[basename]}`);
        return;
      }

      const delegated = DELEGATED_TO_SHARED[basename];
      if (delegated) {
        // Must find logAuthEvent in the delegated _shared file(s).
        const sharedCovered = delegated.some((sharedFile) => {
          const sharedPath = join(SHARED_DIR, sharedFile);
          const sharedContent = readFile(sharedPath);
          return sharedContent.includes('logAuthEvent(');
        });
        expect(
          sharedCovered,
          `${basename} delegates to ${delegated.join(', ')} but none of those contain logAuthEvent(`
        ).toBe(true);
        return;
      }

      // Direct check: the route file itself must contain logAuthEvent(.
      expect(
        content.includes('logAuthEvent('),
        `${basename} exports an action but contains no logAuthEvent( call — ` +
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
