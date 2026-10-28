/**
 * Shared session-planting helpers for Cypress specs that need a valid session
 * cookie before visiting a session-gated route.
 *
 * Used by: a11y-sweep.cy.ts, device.cy.ts, mfa-picker.cy.ts, passkey-use.cy.ts
 *
 * Strategy: drive the identifier → (optional) password flow via cy.request (no
 * UI). cy.request shares the browser cookie jar, so set-cookie headers from
 * these actions apply to the subsequent cy.visit.
 */
import { checkA11y } from './a11y';
import { UNSAFE_decodeViaTurboStream } from 'react-router';

/** Seeded password for all fake-provider test users. */
export const FAKE_PASSWORD = 'hunter2';

/**
 * Derive the absolute-or-/id-prefixed request path deterministically
 * instead of fragile substring surgery. Absolute http(s) URLs pass through;
 * path-only targets are served under the /id basename, so ensure exactly one /id prefix.
 */
export function toRequestUrl(target: string): string {
  if (/^https?:\/\//i.test(target)) return target; // absolute → pass through
  const path = target.startsWith('/') ? target : `/${target}`;
  return path.startsWith('/id/') || path === '/id' ? path : `/id${path}`;
}

/**
 * Decode the HTML entities React emits inside attribute values (& → &amp; etc.).
 * Attribute values round-tripped back into a request MUST be decoded first —
 * an escaped CSRF token 403s, and an escaped href loses its query separators.
 */
function decodeEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

/**
 * Extract the CSRF hidden-input token from SSR HTML. React entity-escapes
 * attribute values (& → &amp; etc.), so decode before round-tripping the token —
 * otherwise tokens containing escapable chars 403 intermittently.
 */
export function extractCsrf(html: string): string {
  return decodeEntities(/name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '');
}

const CHOOSER_METHODS = ['passkey', 'password', 'otp_email', 'idp'];

type RouteEntry = { data?: { methods?: unknown } };

// Single-fetch dedupes strings, so `methods` is an index array in the raw payload; only the
// router's own decoder resolves it back to names.
export async function chooserMethodsFromSingleFetch(body: string): Promise<string[]> {
  if (!body) return [];
  const { value } = await UNSAFE_decodeViaTurboStream(new Response(body).body!, globalThis);
  for (const entry of Object.values((value ?? {}) as Record<string, RouteEntry>)) {
    const methods = entry?.data?.methods;
    if (Array.isArray(methods)) {
      return methods.filter((m): m is string => CHOOSER_METHODS.includes(m));
    }
  }
  return [];
}

/**
 * Extract the redirect path from a React-Router v7 single-fetch (turbo-stream)
 * action response body. A redirecting action serializes as e.g.
 *   [{…},"redirect","/login/password?loginName=…","status",302,…]
 * so the path is the string value immediately following the literal "redirect".
 * Returns '' when the body is not a redirect (e.g. a re-render with field errors).
 */
export function extractSingleFetchRedirect(body: string): string {
  const m = /"redirect","((?:[^"\\]|\\.)*)"/.exec(body);
  return m ? m[1].replace(/\\"/g, '"') : '';
}

/**
 * UI counterpart of the chooser hop, for specs that drive the identifier step through the
 * browser: assert the chooser, then take its Password entry to the password form.
 *
 * The identifier step routes EVERY account with >= 1 usable method to /login/method, so a
 * password account reaches its form one hop later than it used to. Every method entry on the
 * chooser is a real <a> (method.tsx), not a JS handler, so this hop works in the suite's
 * no-hydration mode exactly like the redirect it replaced.
 *
 * The screen is swept for axe violations HERE rather than only in a11y-sweep.cy.ts: this hop is
 * now on the critical path of most sign-in specs, so every one of them exercises the chooser and
 * gets the check for free — a newly introduced violation cannot survive to the merge gate.
 */
export function chooseMethodPassword() {
  cy.location('pathname').should('eq', '/id/login/method');
  checkA11y();
  cy.contains('a', 'Password').click();
}

/**
 * Plants a session cookie for `loginName` via cy.request (no UI).
 * Drives identifier → (optional) password so byLoginName finds a valid entry.
 *
 * SINGLE-FETCH: the prod (SSR) build routes route actions through React-Router's
 * single-fetch `.data` endpoint, NOT the bare route URL. A native document
 * `POST /id/login` returns 405 ("no action for route login") because RR only
 * dispatches the action via `/id/login.data?index` (the exact request a hydrated
 * <Form> makes — see core-signin.cy.ts's 202 POST /id/login.data?index). We mirror
 * that here: POST the `.data` endpoint and read the turbo-stream redirect to decide
 * whether a password step follows. cy.request shares the cookie jar, so the
 * Set-Cookie `sessions` value from each step carries into the subsequent cy.visit.
 *
 * CHOOSER HOP: the identifier step no longer names a per-method screen — every account with at
 * least one usable method now redirects to /login/method. The password step is therefore read
 * off the chooser's loader payload instead of off the redirect target, and it runs under the
 * SAME condition the redirect used to encode: password is the account's ONLY method. That
 * equivalence is deliberate. Completing the factor for multi-method accounts too would look
 * harmless but doubles their password attempts across the suite, and /login/password is rate
 * limited at 5 per 5 min per (ip + loginName) — the specs would 429 on their own fixtures.
 * A multi-method account needs no second step here anyway: the identifier redirect already
 * minted its session, which is all this helper plants. Specs that additionally need a COMPLETED
 * password login (sudo freshness, the hint write) drive that factor explicitly and say so.
 * The direct /login/password target is still handled: the ignoreUnknownUsernames ghost-session
 * path in login.service.ts returns it without going through the chooser.
 */
function completePasswordStep(pwPageUrl: string, loginName: string, fallbackCsrf: string) {
  cy.request(pwPageUrl).then((pwPage) => {
    const pwCsrf = extractCsrf(pwPage.body as string) || fallbackCsrf;
    // The password route is a leaf (non-index) route: its single-fetch action
    // lives at <path>.data (no ?index). Preserve the loginName query the
    // redirect carried so the loader/action resolves the right user.
    const [pathOnly, query = ''] = pwPageUrl.split('?');
    const pwDataUrl = `${pathOnly}.data${query ? `?${query}` : ''}`;
    cy.request({
      method: 'POST',
      url: pwDataUrl,
      form: true,
      body: { csrf: pwCsrf, loginName, password: FAKE_PASSWORD },
      followRedirect: false,
    });
  });
}

export function loginAndGetSession(loginName: string) {
  cy.request('/id/login').then((resp) => {
    const csrf = extractCsrf(resp.body as string);
    cy.request({
      method: 'POST',
      url: '/id/login.data?index',
      form: true,
      body: { csrf, loginName },
      followRedirect: false,
    }).then((post) => {
      const target = extractSingleFetchRedirect(String(post.body ?? ''));
      if (target.includes('/login/password')) {
        completePasswordStep(toRequestUrl(target), loginName, csrf);
        return;
      }
      if (!target.includes('/login/method')) return;
      // Ask the chooser's loader (single-fetch .data) what this account can actually use.
      // followRedirect:false because a sole-linked-IdP account is answered by a 302 to the
      // provider — an external hop this helper must never take. Its body carries no methods,
      // so it correctly falls through with the session the identifier step already planted.
      const [pathOnly, query = ''] = toRequestUrl(target).split('?');
      cy.request({
        url: `${pathOnly}.data${query ? `?${query}` : ''}`,
        followRedirect: false,
      }).then((chooser) => {
        cy.then(() => chooserMethodsFromSingleFetch(String(chooser.body ?? ''))).then((methods) => {
          if (methods.length !== 1 || methods[0] !== 'password') return;
          completePasswordStep(
            toRequestUrl(target.replace('/login/method', '/login/password')),
            loginName,
            csrf
          );
        });
      });
    });
  });
}
