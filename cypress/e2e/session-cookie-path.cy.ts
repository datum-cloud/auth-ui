import { extractCsrf } from '../support/session';

// The sessions cookie moved from Path=/ to Path=/id (like every sibling cookie). For one release,
// each response that sets it also expires the old Path=/ cookie so a browser never holds both.
describe('sessions cookie scope after sign-in', () => {
  it('sets sessions at Path=/id and expires the old Path=/ cookie in the same response', () => {
    cy.request('/id/login').then((page) => {
      cy.request({
        method: 'POST',
        url: '/id/login.data?index',
        form: true,
        body: { csrf: extractCsrf(page.body as string), loginName: 'alice@acme.test' },
        followRedirect: false,
      }).then((res) => {
        const setCookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
        const scoped = setCookies.find((c) => /^sessions=[^;]+;/.test(c));
        expect(scoped, 'the sign-in sets the sessions cookie').to.be.a('string');
        expect(scoped).to.match(/;\s*Path=\/id(;|$)/i);
        expect(
          setCookies.some((c) => /^sessions=;\s*Path=\/;\s*Max-Age=0/i.test(c)),
          'the clearing header for the old root cookie is present'
        ).to.equal(true);
      });
    });
    cy.getCookie('sessions').should('have.property', 'path', '/id');
  });

  it('a browser holding the old Path=/ cookie drops it on sign-in', () => {
    cy.setCookie('sessions', 'legacy-root-value', { path: '/' });
    cy.getCookies().should((all) => {
      expect(all.filter((c) => c.name === 'sessions' && c.path === '/')).to.have.length(1);
    });
    // Submit from the page with the browser's own fetch, so the browser (not cy.request's cookie
    // automation) applies both Set-Cookie headers exactly as it would for a real user.
    cy.visit('/id/login');
    cy.document().then((doc) => {
      const csrf = doc.querySelector<HTMLInputElement>('input[name="csrf"]')?.value ?? '';
      expect(csrf, 'the login page carries a csrf token').to.not.equal('');
      cy.window()
        .then((win) =>
          win.fetch('/id/login.data?index', {
            method: 'POST',
            credentials: 'same-origin',
            redirect: 'manual',
            body: new URLSearchParams({ csrf, loginName: 'alice@acme.test' }),
          })
        )
        .its('status')
        .should('be.lessThan', 400);
    });
    cy.getCookies().should((all) => {
      const sessions = all.filter((c) => c.name === 'sessions');
      expect(
        sessions.map((c) => c.path),
        'only the /id cookie remains'
      ).to.deep.equal(['/id']);
    });
  });
});
