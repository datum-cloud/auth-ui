import App from '@/root';

// Component (mountRemixRoute) test for the root App export. Confirms the app-wide
// MaxMindTracker mount (root.tsx) actually wires the loader's maxmindAccountId into the
// tracker, which synchronously sets window.__mmapiws.accountId in its mount effect —
// the concrete, testable side-effect MaxMindTracker produces (see
// app/modules/fraud/maxmind-tracker.tsx). Regression guard for: login/SSO pages never
// fingerprinting because MaxMindTracker was only mounted on the two password-signup routes.
describe('root App', () => {
  it('mounts MaxMindTracker at the app root with the loader-supplied maxmindAccountId', () => {
    cy.mountRemixRoute(<App />, {
      path: '/login',
      initialEntries: ['/login'],
      remixStubProps: {
        loaderData: {
          locale: 'en',
          messages: {},
          cspNonce: undefined,
          fathomSiteId: undefined,
          maxmindAccountId: 'test-maxmind-acct-123',
        },
      },
    });
    cy.window().its('__mmapiws').its('accountId').should('equal', 'test-maxmind-acct-123');
  });
});
