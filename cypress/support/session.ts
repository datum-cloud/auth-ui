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
 * Extract the CSRF hidden-input token from SSR HTML. React entity-escapes
 * attribute values (& → &amp; etc.), so decode before round-tripping the token —
 * otherwise tokens containing escapable chars 403 intermittently.
 */
export function extractCsrf(html: string): string {
  const raw = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
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
 * For passkey-only users the identifier step already creates the session and
 * redirects to /login/passkey — the password branch is skipped.
 * For password users the identifier step redirects to /login/password, then the
 * password .data POST completes the session.
 */
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
        const pwPageUrl = toRequestUrl(target);
        cy.request(pwPageUrl).then((pwPage) => {
          const pwCsrf = extractCsrf(pwPage.body as string) || csrf;
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
    });
  });
}
