// cypress/component/routes/sso/provider-error-render.cy.tsx
//
// sso/provider/error.tsx renders after a failed IdP round-trip (idpReturnUrls' failure URL now
// carries requestId/organization — see idp-return-urls.cy.ts). Its "Back to sign in" link used
// to hardcode paths.login.index() (no args), dropping the ceremony context. It now reads
// requestId/organization off the CURRENT URL and threads them onto the link.
import SsoError from '@/routes/sso/provider/error';

describe('sso/provider/error — "Back to sign in" preserves the ceremony', () => {
  it('threads requestId + organization from the current URL onto "Back to sign in"', () => {
    cy.mount(<SsoError />, {
      path: '/sso/:provider/error',
      initialEntries: [
        '/sso/google/error?reason=signin_failed&requestId=oidc_V2_123&organization=org-1',
      ],
    });
    cy.findByRole('link', { name: 'Back to sign in' }).should(
      'have.attr',
      'href',
      '/login?requestId=oidc_V2_123&organization=org-1'
    );
  });

  it('degrades to a bare /login when no ceremony context is present', () => {
    cy.mount(<SsoError />, {
      path: '/sso/:provider/error',
      initialEntries: ['/sso/google/error?reason=signin_failed'],
    });
    cy.findByRole('link', { name: 'Back to sign in' }).should('have.attr', 'href', '/login');
  });
});
