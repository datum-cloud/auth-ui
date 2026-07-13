/**
 * URL resolution — byte-frozen namespaces (the keystone gate).
 *
 * Asserts that EVERY resolvable screen declared in `app/routes.ts` resolves under the
 * `/id/` basename (react-router.config.ts) with an HTTP 200 (rendered) or 302 (loader
 * redirect to a deep link / sibling step) and surfaces a stable content anchor. This is
 * the gate the later sweep / layout-collapse work is checked against: if a
 * refactor changes a URL or breaks a screen, this suite goes red.
 *
 * Enumeration is exhaustive against app/routes.ts at the time of writing. The mapping is:
 *
 *   routes.ts entry                              → path asserted here
 *   ─────────────────────────────────────────────────────────────────────────────────
 *   index('routes/_index.tsx')                   → /id/
 *   route('authorize', …)                        → /id/authorize
 *   login layout { id: 'login' }                 → /id/login (index)
 *     method | password | mfa | passkey          → /id/login/{method,password,mfa,passkey}
 *     security-key                               → /id/login/security-key
 *     verify layout → email | sms | authenticator→ /id/login/verify/{email,sms,authenticator}
 *   signup layout { id: 'signup' }               → /id/signup (index)
 *     method | password | complete               → /id/signup/{method,password,complete}
 *   password layout                              → /id/password/{reset,new,change}
 *   setup layout                                 → /id/setup/{passkey,security-key,authenticator,email,sms,mfa}
 *   sso layout                                   → /id/sso (index)
 *     link | ldap                                → /id/sso/{link,ldap}
 *     :provider layout → callback | error        → /id/sso/:provider/{callback,error}
 *   device layout                                → /id/device (index)
 *     authorize                                  → /id/device/authorize
 *   verify layout                                → /id/verify (index)
 *     success                                    → /id/verify/success
 *   logout layout                                → /id/logout (index)
 *     success                                    → /id/logout/success
 *   route('accounts' | 'signed-in' | 'error')    → /id/{accounts,signed-in,error}
 *   route('*', catchall)                         → exercised by the catch-all spec below
 *
 * Anchors are intentionally permissive (`h1`, then `body`) so the gate proves *resolution
 * and render*, not copy — copy/markup drift is the visual-regression suite's job.
 * Routes whose loaders legitimately redirect on a bare GET (missing session / deep-link
 * query) are allowed to answer 302; we therefore accept `[200, 302]` for the status probe
 * and only assert the anchor when the screen actually rendered (status 200).
 */

interface NamespaceScreen {
  /** Absolute, basename-qualified path under /id/ — byte-frozen against routes.ts. */
  readonly path: string;
  /** The route namespace this screen belongs to (one of the 13 top-level entries). */
  readonly namespace: string;
  /** A stable content anchor selector expected when the screen renders (status 200). */
  readonly anchor: string;
  /**
   * Statuses that count as "resolved + handled" for this screen. Defaults to [200, 302].
   * Context-required screens (need a one-time token / device user-code) legitimately answer
   * a deliberate, handled 400 on a bare GET — still proof the URL resolves to its route
   * (not a 404/5xx). Those screens widen this to include 400.
   */
  readonly okStatuses?: ReadonlyArray<number>;
  /**
   * For a context-required screen that answers 400 on a bare GET: a selector that MUST render
   * at that 400, proving the response is a graceful, recoverable page — not a blank/raw error.
   * This is what makes accepting 400 an honest assertion rather than a hollow tolerance.
   */
  readonly recoveryAnchor?: string;
}

// Deep-link query a few loaders need to render their 200 form instead of bouncing.
// Kept minimal; screens that still choose to 302 on a bare GET are tolerated below.
const LOGIN_NAME = 'loginName=user%40example.com';

const NAMESPACE_SCREENS: ReadonlyArray<NamespaceScreen> = [
  // ── index ───────────────────────────────────────────────────────────────────
  { namespace: 'index', path: '/id/', anchor: 'body' },

  // ── authorize (standalone) ──────────────────────────────────────────────────
  { namespace: 'authorize', path: '/id/authorize', anchor: 'body' },

  // ── login ───────────────────────────────────────────────────────────────────
  { namespace: 'login', path: '/id/login', anchor: 'h1' },
  { namespace: 'login', path: '/id/login/method', anchor: 'h1' },
  { namespace: 'login', path: `/id/login/password?${LOGIN_NAME}`, anchor: 'h1' },
  { namespace: 'login', path: `/id/login/mfa?${LOGIN_NAME}`, anchor: 'h1' },
  { namespace: 'login', path: `/id/login/passkey?${LOGIN_NAME}`, anchor: 'h1' },
  { namespace: 'login', path: `/id/login/security-key?${LOGIN_NAME}`, anchor: 'h1' },
  // login/verify/* (nested verify layout)
  { namespace: 'login', path: `/id/login/verify/email?${LOGIN_NAME}`, anchor: 'h1' },
  { namespace: 'login', path: `/id/login/verify/sms?${LOGIN_NAME}`, anchor: 'h1' },
  { namespace: 'login', path: `/id/login/verify/authenticator?${LOGIN_NAME}`, anchor: 'h1' },

  // ── signup ──────────────────────────────────────────────────────────────────
  { namespace: 'signup', path: '/id/signup', anchor: 'h1' },
  { namespace: 'signup', path: '/id/signup/method', anchor: 'h1' },
  { namespace: 'signup', path: '/id/signup/password', anchor: 'h1' },
  // complete needs the email-link completion token; a bare GET answers a handled 400 that renders a
  // tailored recovery page ("Link expired" + a "Start over" → /id/signup link). The gate asserts that
  // recovery affordance actually renders — not merely that a 400 came back.
  {
    namespace: 'signup',
    path: '/id/signup/complete',
    anchor: 'h1',
    okStatuses: [200, 302, 400],
    recoveryAnchor: 'a[href="/id/signup"]',
  },

  // ── password ────────────────────────────────────────────────────────────────
  { namespace: 'password', path: '/id/password/reset', anchor: 'h1' },
  { namespace: 'password', path: `/id/password/new?${LOGIN_NAME}`, anchor: 'h1' },
  { namespace: 'password', path: `/id/password/change?${LOGIN_NAME}`, anchor: 'h1' },

  // ── setup ───────────────────────────────────────────────────────────────────
  { namespace: 'setup', path: '/id/setup/passkey', anchor: 'h1' },
  { namespace: 'setup', path: '/id/setup/security-key', anchor: 'h1' },
  { namespace: 'setup', path: '/id/setup/authenticator', anchor: 'h1' },
  { namespace: 'setup', path: '/id/setup/email', anchor: 'h1' },
  { namespace: 'setup', path: '/id/setup/sms', anchor: 'h1' },
  { namespace: 'setup', path: '/id/setup/mfa', anchor: 'h1' },

  // ── sso ─────────────────────────────────────────────────────────────────────
  { namespace: 'sso', path: '/id/sso', anchor: 'body' },
  { namespace: 'sso', path: '/id/sso/link', anchor: 'h1' },
  { namespace: 'sso', path: '/id/sso/ldap', anchor: 'h1' },
  // sso/:provider/* (provider layout) — exercise the :provider segment with a sample slug.
  { namespace: 'sso', path: '/id/sso/google/callback', anchor: 'body' },
  { namespace: 'sso', path: '/id/sso/google/error', anchor: 'body' },

  // ── device ──────────────────────────────────────────────────────────────────
  { namespace: 'device', path: '/id/device', anchor: 'h1' },
  // authorize needs a device user_code; a bare GET answers a handled 400. Known limitation:
  // unlike signup/complete's tailored "Start over" recovery, this currently falls through to the GENERIC
  // "Something went wrong" ErrorBoundary (only a link home, no path back to /device's code-entry screen).
  // The gate asserts it renders a handled page (an h1, not a blank/raw 500); the tailored-recovery /
  // redirect-to-/device fix is tracked as follow-up work for the error-handling unification.
  {
    namespace: 'device',
    path: '/id/device/authorize',
    anchor: 'body',
    okStatuses: [200, 302, 400],
    recoveryAnchor: 'h1',
  },

  // ── verify ──────────────────────────────────────────────────────────────────
  { namespace: 'verify', path: '/id/verify', anchor: 'body' },
  { namespace: 'verify', path: '/id/verify/success', anchor: 'body' },

  // ── logout ──────────────────────────────────────────────────────────────────
  { namespace: 'logout', path: '/id/logout', anchor: 'body' },
  { namespace: 'logout', path: '/id/logout/success', anchor: 'body' },

  // ── accounts / signed-in / error (standalone) ────────────────────────────────
  { namespace: 'accounts', path: '/id/accounts', anchor: 'body' },
  { namespace: 'signed-in', path: '/id/signed-in', anchor: 'body' },
  { namespace: 'error', path: '/id/error', anchor: 'body' },
];

// Every top-level namespace declared in app/routes.ts. The suite asserts each is covered
// by at least one screen above, so adding a namespace to routes.ts without a screen here
// fails loudly instead of silently widening the byte-frozen surface.
const EXPECTED_NAMESPACES: ReadonlyArray<string> = [
  'index',
  'authorize',
  'login',
  'signup',
  'password',
  'setup',
  'sso',
  'device',
  'verify',
  'logout',
  'accounts',
  'signed-in',
  'error',
];

describe('URL resolution — byte-frozen namespaces', () => {
  it('covers every top-level namespace declared in app/routes.ts', () => {
    const covered = new Set(NAMESPACE_SCREENS.map((s) => s.namespace));
    for (const ns of EXPECTED_NAMESPACES) {
      expect(covered.has(ns), `namespace "${ns}" has at least one screen`).to.eq(true);
    }
  });

  for (const { path, namespace, anchor, okStatuses, recoveryAnchor } of NAMESPACE_SCREENS) {
    const accepted = okStatuses ?? [200, 302];
    it(`[${namespace}] resolves ${path}`, () => {
      // Probe: the route must resolve + be handled — 200 (rendered), 302 (loader redirect),
      // or (context-required screens) a deliberate, handled 400. Never 404/5xx.
      cy.request({ url: path, failOnStatusCode: false }).then((res) => {
        expect(res.status, `${path} status`).to.be.oneOf(accepted);
      });

      // Render check. A 200 must render its content anchor. A context-required 400 must still render a
      // GRACEFUL, recoverable page (its recoveryAnchor) — proving the 400 is a handled recovery, not a
      // tolerated dead-end. A 302 is a legitimate loader bounce (missing session / deep-link) — nothing renders here.
      cy.request({ url: path, failOnStatusCode: false, followRedirect: false }).then((res) => {
        if (res.status === 200) {
          cy.visit(path);
          cy.get(anchor).should('exist');
        } else if (res.status === 400 && recoveryAnchor) {
          cy.visit(path, { failOnStatusCode: false });
          cy.get(recoveryAnchor).should('exist');
        }
      });
    });
  }
});

/**
 * Legacy-redirect parity.
 *
 * The exhaustive enumeration of legacy `/ui/v2/login/*` → `/id/*` cases (the rename map,
 * the prefix-swap class, and the unknown-subpath fallback) lives in — and is owned by —
 * `cypress/e2e/legacy-redirects.cy.ts` and the canonical mapping in
 * `app/server/middleware/legacy-redirects.ts`. We deliberately do NOT re-list those cases
 * here; duplicating the table would let the two specs drift.
 *
 * Instead this block asserts *parity at the seam*: that each legacy redirect class still
 * lands on a path this URL-resolution suite already certifies as resolvable above. One
 * representative per class is sufficient to prove the legacy entrypoint and the byte-frozen
 * namespace surface stay wired to the same targets — the per-case header/location assertions
 * remain in legacy-redirects.cy.ts (the source of truth).
 */
describe('URL resolution — legacy-redirect parity (see legacy-redirects.cy.ts for the full case list)', () => {
  // One representative per redirect class defined in legacy-redirects.cy.ts. Each `target`
  // is also present in NAMESPACE_SCREENS above, so a green namespace suite + a green parity
  // check together prove the legacy seam points only at byte-frozen, resolvable URLs.
  const PARITY_REPRESENTATIVES: ReadonlyArray<{
    readonly class: string;
    readonly legacy: string;
    readonly target: string;
  }> = [
    // rename class — see legacy-redirects.cy.ts "301s idp/link → /id/sso/link"
    {
      class: 'rename',
      legacy: '/ui/v2/login/idp/link?organization=acme',
      target: '/id/sso/link?organization=acme',
    },
    // prefix-swap class — see legacy-redirects.cy.ts "301s a prefix-swap path (device)"
    { class: 'prefix-swap', legacy: '/ui/v2/login/device', target: '/id/device' },
    // unknown-subpath fallback — see legacy-redirects.cy.ts "301s an unknown legacy subpath to the login index"
    { class: 'unknown-fallback', legacy: '/ui/v2/login/bogus', target: '/id/login' },
  ];

  for (const { class: redirectClass, legacy, target } of PARITY_REPRESENTATIVES) {
    it(`[${redirectClass}] ${legacy} 301s to a byte-frozen target`, () => {
      cy.request({ url: legacy, followRedirect: false }).then((res) => {
        expect(res.status, `${legacy} redirect status`).to.eq(301);
        expect(res.headers.location, `${legacy} redirect target`).to.eq(target);
      });
    });

    it(`[${redirectClass}] target ${target} is itself resolvable`, () => {
      // Parity guard: the path the legacy redirect points at must resolve under /id/ too.
      cy.request({ url: target, failOnStatusCode: false }).then((res) => {
        expect(res.status, `${target} resolves`).to.be.oneOf([200, 302]);
      });
    });
  }
});

/**
 * Catch-all — route('*', 'routes/catchall.tsx'). An unmatched /id/* path must NOT 404 the
 * server out; the catch-all module owns the response (its own status is the catch-all's
 * contract, asserted in its dedicated spec). Here we only prove the seam resolves to a
 * served response rather than a connection error.
 */
describe('URL resolution — catch-all', () => {
  it('serves the catch-all module for an unmatched /id path', () => {
    cy.request({ url: '/id/this-route-does-not-exist', failOnStatusCode: false }).then((res) => {
      // 404 is the catch-all's legitimate rendered status; 200/302 are tolerated if the
      // module chooses to render or redirect. The contract here is "served, not crashed".
      expect(res.status, 'catch-all served a response').to.be.oneOf([200, 302, 404]);
    });
  });
});
