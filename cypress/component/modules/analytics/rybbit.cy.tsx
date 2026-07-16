// cypress/component/modules/analytics/rybbit.cy.tsx
//
// Component port of app/modules/analytics/__tests__/fathom.test.tsx, adapted for Rybbit.
//
// Rybbit has no npm package (raw <script> tag integration), so — unlike the old fathom-client
// virtual-module stub — there is nothing to virtualize. window.rybbit is stubbed directly as a
// plain browser global; the SUT (resolveRybbitSiteId / RybbitAnalytics / trackAuthEvent /
// identifyUser / TrackOnMount) runs for real. cy.mount flushes effects (act), so calls are
// observable in the .then()/.should() after mount.
import {
  resolveRybbitSiteId,
  RybbitAnalytics,
  TrackOnMount,
  identifyUser,
  clearIdentifiedUser,
} from '@/modules/analytics/rybbit';

interface RybbitCall {
  fn: 'event' | 'identify' | 'pageview' | 'clearUserId';
  args: unknown[];
}

const rybbitCalls = (): RybbitCall[] =>
  (window as unknown as { __rybbitCalls: RybbitCall[] }).__rybbitCalls;

beforeEach(() => {
  (window as unknown as { __rybbitCalls: RybbitCall[] }).__rybbitCalls = [];
  window.rybbit = {
    event: (...args) => rybbitCalls().push({ fn: 'event', args }),
    identify: (...args) => rybbitCalls().push({ fn: 'identify', args }),
    clearUserId: (...args) => rybbitCalls().push({ fn: 'clearUserId', args }),
    pageview: (...args) => rybbitCalls().push({ fn: 'pageview', args }),
  };
});

describe('resolveRybbitSiteId', () => {
  it('passes a configured id through in ANY environment, and normalizes unset/empty to undefined', () => {
    expect(resolveRybbitSiteId('997f89789d8f')).to.equal('997f89789d8f');
    expect(resolveRybbitSiteId(undefined)).to.be.undefined;
    expect(resolveRybbitSiteId('')).to.be.undefined;
  });
});

describe('RybbitAnalytics', () => {
  it('renders nothing when siteId is falsy', () => {
    cy.mount(<RybbitAnalytics />);
    cy.get('script[data-site-id]').should('not.exist');
  });

  it('renders the Rybbit script tag with siteId, tag and nonce', () => {
    cy.mount(<RybbitAnalytics siteId="997f89789d8f" tag="staging" nonce="abc123" />);
    cy.get('script[data-site-id="997f89789d8f"]').should(($el) => {
      const el = $el.get(0) as HTMLScriptElement;
      expect(el.src).to.equal('https://app.rybbit.io/api/script.js');
      expect(el.dataset.tag).to.equal('staging');
      expect(el.defer).to.equal(true);
      // React special-cases <script nonce> — it is set as a DOM property, never rendered as
      // an inspectable HTML attribute.
      expect(el.nonce).to.equal('abc123');
    });
  });
});

describe('TrackOnMount + identifyUser', () => {
  it('TrackOnMount fires its event exactly once on mount', () => {
    cy.mount(<TrackOnMount event="signup_submitted" />);
    cy.wrap(null).should(() => {
      expect(rybbitCalls().filter((c) => c.fn === 'event')).to.have.length(1);
    });
    cy.then(() => {
      expect(rybbitCalls().find((c) => c.fn === 'event')?.args).to.deep.equal(['signup_submitted']);
    });
  });

  it('identifyUser calls window.rybbit.identify with the given user id', () => {
    identifyUser('user-42');
    expect(rybbitCalls().find((c) => c.fn === 'identify')?.args).to.deep.equal(['user-42']);
  });

  it('identifyUser passes traits through when given', () => {
    identifyUser('user-42', { email: 'user@example.com' });
    expect(rybbitCalls().find((c) => c.fn === 'identify')?.args).to.deep.equal([
      'user-42',
      { email: 'user@example.com' },
    ]);
  });

  it('clearIdentifiedUser calls window.rybbit.clearUserId', () => {
    clearIdentifiedUser();
    expect(rybbitCalls().filter((c) => c.fn === 'clearUserId')).to.have.length(1);
  });
});
