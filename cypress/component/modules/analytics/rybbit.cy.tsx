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
  trackAuthEvent,
} from '@/modules/analytics/rybbit';

interface RybbitCall {
  fn: 'event' | 'identify' | 'pageview' | 'clearUserId';
  args: unknown[];
}

const rybbitCalls = (): RybbitCall[] =>
  (window as unknown as { __rybbitCalls: RybbitCall[] }).__rybbitCalls;

beforeEach(() => {
  // React 19 loads `<script async>` resources for real; never let a spec reach the vendor host.
  cy.intercept('https://app.rybbit.io/**', { statusCode: 200, body: '' });
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
  it('renders no script tag when siteId is falsy, and renders the Rybbit script with siteId, tag and nonce when it is set', () => {
    // Asserted FIRST on purpose: `should('not.exist')` on `script[data-site-id]` is a
    // whole-DOM negative, so it is only meaningful before any mount has injected a script.
    cy.mount(<RybbitAnalytics />);
    cy.get('script[data-site-id]').should('not.exist');

    cy.mount(<RybbitAnalytics siteId="997f89789d8f" tag="staging" nonce="abc123" />);
    cy.get('script[data-site-id="997f89789d8f"]').should(($el) => {
      const el = $el.get(0) as HTMLScriptElement;
      expect(el.src).to.equal('https://app.rybbit.io/api/script.js');
      expect(el.dataset.tag).to.equal('staging');
      expect(el.async).to.equal(true);
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

  it('identifies the user with optional traits, and clears the identified user', () => {
    // Indexed off `filter`, NOT `find` — both calls land in the same recorder here, and
    // `find` would return call #0 again for the second assertion, silently never checking
    // the traits payload.
    identifyUser('user-42');
    expect(rybbitCalls().filter((c) => c.fn === 'identify')[0]?.args).to.deep.equal(['user-42']);

    identifyUser('user-42', { name: 'Ada' });
    expect(rybbitCalls().filter((c) => c.fn === 'identify')[1]?.args).to.deep.equal([
      'user-42',
      { name: 'Ada' },
    ]);

    clearIdentifiedUser();
    expect(rybbitCalls().filter((c) => c.fn === 'clearUserId')).to.have.length(1);
  });
});

// The gated tag first appears with the allowlisted page, so that page's mount effects can run
// before the script has defined window.rybbit. Calls must wait for the tag's load event.
describe('calls made before the Rybbit script has loaded', () => {
  let tag: HTMLScriptElement | undefined;

  beforeEach(() => {
    window.rybbit = undefined;
    // React never removes a hoisted <script async>, so earlier mounts leave their tag behind.
    document.querySelectorAll('script[src="https://app.rybbit.io/api/script.js"]').forEach((el) => {
      el.remove();
    });
  });

  afterEach(() => {
    tag?.remove();
    tag = undefined;
  });

  it('runs them once the tag has loaded', () => {
    tag = document.createElement('script');
    // A non-JS type keeps the browser from fetching or running it; only the selector matters.
    tag.type = 'application/x-test';
    tag.src = 'https://app.rybbit.io/api/script.js';
    document.head.appendChild(tag);

    identifyUser('user-7');
    trackAuthEvent('login_completed');
    expect(rybbitCalls()).to.have.length(0);

    window.rybbit = {
      event: (...args) => rybbitCalls().push({ fn: 'event', args }),
      identify: (...args) => rybbitCalls().push({ fn: 'identify', args }),
      clearUserId: (...args) => rybbitCalls().push({ fn: 'clearUserId', args }),
      pageview: (...args) => rybbitCalls().push({ fn: 'pageview', args }),
    };
    tag.dispatchEvent(new Event('load'));
    expect(rybbitCalls()).to.deep.equal([
      { fn: 'identify', args: ['user-7'] },
      { fn: 'event', args: ['login_completed'] },
    ]);
  });

  it('drops them silently when no tag is on the page', () => {
    expect(() => trackAuthEvent('login_completed')).not.to.throw();
    expect(rybbitCalls()).to.have.length(0);
  });
});
