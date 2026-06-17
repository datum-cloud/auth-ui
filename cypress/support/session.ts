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
 * CODE-MIN-35: derive the absolute-or-/id-prefixed request path deterministically
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
 * Plants a session cookie for `loginName` via cy.request (no UI).
 * Drives identifier → (optional) password so byLoginName finds a valid entry.
 *
 * For passkey-only users the identifier step already creates the session and
 * redirects to /login/passkey — the password branch is skipped.
 * For password users the identifier step goes to /login/password, then the
 * password POST completes the session.
 *
 * Guard: absolute URLs (http/https) are passed straight to cy.request;
 * only the /id prefix fix is applied for path-relative targets.
 */
export function loginAndGetSession(loginName: string) {
  cy.request('/id/login').then((resp) => {
    const csrf = extractCsrf(resp.body as string);
    cy.request({
      method: 'POST',
      url: '/id/login',
      form: true,
      body: { csrf, loginName },
      followRedirect: false,
    }).then((post) => {
      const target = String(post.headers.location ?? '');
      if (target.includes('/login/password')) {
        const pwPageUrl = toRequestUrl(target);
        cy.request(pwPageUrl).then((pwPage) => {
          const pwCsrf = extractCsrf(pwPage.body as string) || csrf;
          cy.request({
            method: 'POST',
            url: pwPageUrl,
            form: true,
            body: { csrf: pwCsrf, loginName, password: FAKE_PASSWORD },
            followRedirect: false,
          });
        });
      }
    });
  });
}
