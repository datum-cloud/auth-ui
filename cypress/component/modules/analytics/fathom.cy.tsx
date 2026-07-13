// cypress/component/modules/analytics/fathom.cy.tsx
//
// Component port of app/modules/analytics/__tests__/fathom.test.tsx.
//
// The original vi.mock('fathom-client', …) is replaced by a Cypress-only virtual stub of the
// third-party fathom-client SDK (see vite.config.ts), which records every load/trackPageview/
// trackEvent call into window.__fathomCalls. Only the EXTERNAL SDK is doubled — the SUT
// (resolveFathomSiteId / FathomAnalytics / trackAuthEvent / TrackOnMount) runs for real. cy.mount
// flushes effects (act), so calls are observable in the .then() after mount.
import { resolveFathomSiteId, FathomAnalytics, TrackOnMount } from '@/modules/analytics/fathom';

interface FathomCalls {
  load: unknown[][];
  trackPageview: unknown[][];
  trackEvent: unknown[][];
}

const fathomCalls = (): FathomCalls =>
  (window as unknown as { __fathomCalls: FathomCalls }).__fathomCalls;

beforeEach(() => {
  (window as unknown as { __fathomCalls: FathomCalls }).__fathomCalls = {
    load: [],
    trackPageview: [],
    trackEvent: [],
  };
});

describe('resolveFathomSiteId', () => {
  it('returns the id only in production when set, and undefined outside production or when unset', () => {
    expect(resolveFathomSiteId('production', 'SITE123')).to.equal('SITE123');
    expect(resolveFathomSiteId('production', undefined)).to.be.undefined;
    expect(resolveFathomSiteId('development', 'SITE123')).to.be.undefined;
  });
});

describe('FathomAnalytics + TrackOnMount', () => {
  it('does not load/track when siteId is absent; loads once and fires a pageview when set; TrackOnMount fires its event once', () => {
    cy.mount(<FathomAnalytics />);
    cy.then(() => {
      expect(fathomCalls().load).to.have.length(0);
      expect(fathomCalls().trackPageview).to.have.length(0);
    });

    cy.mount(<FathomAnalytics siteId="SITE123" />);
    // useEffect runs as a passive effect after paint (async) — retry until recorded.
    cy.wrap(null).should(() => {
      expect(fathomCalls().load).to.have.length(1);
      expect(fathomCalls().trackPageview).to.have.length(1);
    });
    cy.then(() => {
      expect(fathomCalls().load[0]).to.deep.equal(['SITE123', { auto: false }]);
    });

    cy.mount(<TrackOnMount event="signup_submitted" />);
    cy.wrap(null).should(() => {
      expect(fathomCalls().trackEvent).to.have.length(1);
    });
    cy.then(() => {
      expect(fathomCalls().trackEvent[0]).to.deep.equal(['signup_submitted']);
    });
  });
});
