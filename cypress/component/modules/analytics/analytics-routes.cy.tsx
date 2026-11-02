// cypress/component/modules/analytics/analytics-routes.cy.tsx
//
// The third-party Rybbit script may load only on terminal, credential-free pages. The pure
// matcher is checked directly; RouteGatedRybbitAnalytics is mounted under a memory router with
// the same `/id` basename the app is served under, so the check runs on the pathname React
// Router actually hands the component.
import {
  ANALYTICS_ROUTES,
  isAnalyticsRoute,
  rybbitSkipPatterns,
} from '@/modules/analytics/analytics-routes';
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
  '/signup/success',
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
    expect(ANALYTICS_ROUTES).to.deep.equal(['/signed-in', '/logout/success', '/verify/success']);
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

describe('isAnalyticsRoute query guard', () => {
  it('rejects an allowlisted page whose URL carries the login name or email', () => {
    expect(isAnalyticsRoute('/verify/success', '?loginName=mia%40acme.test')).to.equal(false);
    expect(isAnalyticsRoute('/id/signed-in', '?requestId=r1&email=a%40b.c')).to.equal(false);
  });

  it('allows an allowlisted page with non-identifying query params', () => {
    expect(isAnalyticsRoute('/verify/success', '?requestId=r1&organization=o1')).to.equal(true);
    expect(isAnalyticsRoute('/signed-in', '')).to.equal(true);
  });
});

// Rybbit turns a `re:` skip pattern into `new RegExp(rest)` and tests it against the served
// pathname; a match drops the pageview or event.
describe('rybbitSkipPatterns', () => {
  const skips = (pathname: string) => {
    const patterns = JSON.parse(rybbitSkipPatterns()) as string[];
    return patterns.some((p) => new RegExp(p.replace(/^re:/, '')).test(pathname));
  };

  it('lets the allowlisted served paths through', () => {
    for (const path of ANALYTICS_ROUTES) {
      expect(skips(`/id${path}`), `/id${path}`).to.equal(false);
      expect(skips(`/id${path}/`), `/id${path}/`).to.equal(false);
    }
  });

  it('skips every other page, so client navigations away are not tracked', () => {
    for (const path of [...CREDENTIAL_PATHS, '/accounts', '/signed-in/x']) {
      expect(skips(`/id${path}`), `/id${path}`).to.equal(true);
    }
  });
});

describe('RouteGatedRybbitAnalytics', () => {
  it('renders no script on a credential page served under /id', () => {
    mountAt('/id/login/password');
    cy.get('script[data-site-id]').should('not.exist');
  });

  it('renders no script on an allowlisted page whose URL carries the login name', () => {
    mountAt('/id/verify/success?loginName=mia%40acme.test');
    cy.get('script[data-site-id]').should('not.exist');
  });

  it('renders the Rybbit script on an allowlisted page served under /id', () => {
    mountAt('/id/signed-in');
    cy.get('script[data-site-id="997f89789d8f"]').should(($el) => {
      const el = $el.get(0) as HTMLScriptElement;
      expect(el.src).to.equal('https://app.rybbit.io/api/script.js');
      expect(el.dataset.skipPatterns).to.equal(rybbitSkipPatterns());
    });
  });
});
