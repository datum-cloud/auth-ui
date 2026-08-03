// cypress/component/routes/sso/provider-error-render.cy.tsx
//
// sso/provider/error.tsx renders after a failed IdP round-trip (idpReturnUrls' failure URL now
// carries requestId/organization — see idp-return-urls.cy.ts). Its "Back to sign in" link used
// to hardcode paths.login.index() (no args), dropping the ceremony context. It now reads
// requestId/organization off the CURRENT URL and threads them onto the link.
import SsoError from '@/routes/sso/provider/error';

// Positive and negative of the same link-href feature: same mount, same findByRole
// assertion, differing only by the URL the error page is rendered at. No whole-DOM
// negative involved (the link is always present), so mount order is not load-bearing.
const CASES: [label: string, entry: string, href: string][] = [
  [
    'ceremony context present',
    '/sso/google/error?reason=signin_failed&requestId=oidc_V2_123&organization=org-1',
    '/login?requestId=oidc_V2_123&organization=org-1',
  ],
  ['no ceremony context', '/sso/google/error?reason=signin_failed', '/login'],
];

describe('sso/provider/error — "Back to sign in" preserves the ceremony', () => {
  it('threads requestId + organization from the current URL onto "Back to sign in", degrading to a bare /login without them', () => {
    for (const [label, entry, href] of CASES) {
      cy.mount(<SsoError />, { path: '/sso/:provider/error', initialEntries: [entry] });
      cy.findByRole('link', { name: 'Back to sign in' }).should(($a) => {
        expect($a.attr('href'), label).to.equal(href);
      });
    }
  });
});
