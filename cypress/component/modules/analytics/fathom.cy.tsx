// cypress/component/modules/analytics/fathom.cy.tsx
//
// Component port of app/modules/analytics/__tests__/fathom.test.tsx.
//
// The original vi.mock('fathom-client', …) is replaced by a Cypress-only virtual stub of the
// third-party fathom-client SDK (see vite.config.ts), which records every load/trackPageview/
// trackEvent call into window.__fathomCalls. Only the EXTERNAL SDK is doubled — the SUT
// (resolveFathomSiteId / FathomAnalytics / trackAuthEvent / TrackOnMount) runs for real. cy.mount
// flushes effects (act), so calls are observable in the .then() after mount.
import {
  resolveFathomSiteId,
  FathomAnalytics,
  TrackOnMount,
  trackAuthEvent,
} from '@/modules/analytics/fathom';

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
  it('returns the id in production when set', () => {
    expect(resolveFathomSiteId('production', 'SITE123')).to.equal('SITE123');
  });

  it('returns undefined in production when the id is unset', () => {
    expect(resolveFathomSiteId('production', undefined)).to.be.undefined;
  });

  it('returns undefined outside production even when the id is set', () => {
    expect(resolveFathomSiteId('development', 'SITE123')).to.be.undefined;
    expect(resolveFathomSiteId('test', 'SITE123')).to.be.undefined;
  });
});

describe('FathomAnalytics', () => {
  it('does not load or track when siteId is absent', () => {
    cy.mount(<FathomAnalytics />);
    cy.then(() => {
      expect(fathomCalls().load).to.have.length(0);
      expect(fathomCalls().trackPageview).to.have.length(0);
    });
  });

  it('loads once with auto:false and fires a pageview on first render when siteId is set', () => {
    cy.mount(<FathomAnalytics siteId="SITE123" />);
    // useEffect runs as a passive effect after paint (async) — retry until recorded.
    cy.wrap(null).should(() => {
      expect(fathomCalls().load).to.have.length(1);
      expect(fathomCalls().trackPageview).to.have.length(1);
    });
    cy.then(() => {
      expect(fathomCalls().load[0]).to.deep.equal(['SITE123', { auto: false }]);
    });
  });
});

describe('trackAuthEvent', () => {
  it('forwards the event name to fathom-client trackEvent', () => {
    trackAuthEvent('email_verified');
    expect(fathomCalls().trackEvent).to.have.length(1);
    expect(fathomCalls().trackEvent[0]).to.deep.equal(['email_verified']);
  });
});

describe('TrackOnMount', () => {
  it('fires the conversion event exactly once on mount', () => {
    cy.mount(<TrackOnMount event="signup_submitted" />);
    // useEffect runs as a passive effect after paint (async) — retry until recorded.
    cy.wrap(null).should(() => {
      expect(fathomCalls().trackEvent).to.have.length(1);
    });
    cy.then(() => {
      expect(fathomCalls().trackEvent[0]).to.deep.equal(['signup_submitted']);
    });
  });
});
