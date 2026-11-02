// cypress/component/modules/analytics/analytics-routes.cy.tsx
//
// The third-party Rybbit script may load only on terminal, credential-free pages. The pure
// matcher is checked directly; RouteGatedRybbitAnalytics is mounted under a memory router with
// the same `/id` basename the app is served under, so the check runs on the pathname React
// Router actually hands the component.
import { ANALYTICS_ROUTES, isAnalyticsRoute } from '@/modules/analytics/analytics-routes';
import { RouteGatedRybbitAnalytics } from '@/modules/analytics/rybbit';
import { mount } from 'cypress/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

const CREDENTIAL_PATHS = [
  '/login',
  '/login/password',
  '/login/mfa',
  '/login/verify/sms',
  '/signup',
  '/signup/password',
  '/password/new',
  '/setup/passkey',
  '/setup/authenticator',
  '/recover',
  '/recover/complete',
  '/reauth',
  '/device',
  '/sso/ldap',
];

// React 19 loads `<script async>` resources for real; never let a spec reach the vendor host.
beforeEach(() => {
  cy.intercept('https://app.rybbit.io/**', { statusCode: 200, body: '' });
});

function mountAt(url: string) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: <RouteGatedRybbitAnalytics siteId="997f89789d8f" tag="test" nonce="n1" />,
      },
    ],
    { basename: '/id', initialEntries: [url] }
  );
  return mount(<RouterProvider router={router} />);
}

describe('isAnalyticsRoute', () => {
  it('allows exactly the terminal success pages, with or without the /id basename', () => {
    expect(ANALYTICS_ROUTES).to.deep.equal([
      '/signed-in',
      '/logout/success',
      '/signup/success',
      '/verify/success',
    ]);
    for (const path of ANALYTICS_ROUTES) {
      expect(isAnalyticsRoute(path), path).to.equal(true);
      expect(isAnalyticsRoute(`/id${path}`), `/id${path}`).to.equal(true);
      expect(isAnalyticsRoute(`/id${path}/`), `/id${path}/`).to.equal(true);
    }
  });

  it('rejects credential pages, prefixes and look-alikes', () => {
    for (const path of CREDENTIAL_PATHS) {
      expect(isAnalyticsRoute(path), path).to.equal(false);
      expect(isAnalyticsRoute(`/id${path}`), `/id${path}`).to.equal(false);
    }
    for (const path of ['/', '/id', '/id/', '/signed-in/x', '/idsigned-in', '/x/signed-in']) {
      expect(isAnalyticsRoute(path), path).to.equal(false);
    }
  });
});

describe('RouteGatedRybbitAnalytics', () => {
  it('renders no script on a credential page served under /id', () => {
    mountAt('/id/login/password');
    cy.get('script[data-site-id]').should('not.exist');
  });

  it('renders the Rybbit script on an allowlisted page served under /id', () => {
    mountAt('/id/signed-in');
    cy.get('script[data-site-id="997f89789d8f"]').should(($el) => {
      expect(($el.get(0) as HTMLScriptElement).src).to.equal('https://app.rybbit.io/api/script.js');
    });
  });
});
