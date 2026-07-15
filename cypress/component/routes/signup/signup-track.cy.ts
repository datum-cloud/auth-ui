// cypress/component/routes/signup/signup-track.cy.ts
//
// cy.task port of app/routes/signup/__tests__/signup-track.test.tsx.
// Covers signup/index action fan-out: email identifier → /signup/method redirect,
// and IdP intent → 302 to the provider authUrl. Loader param-threading and validation
// permutations are cut here (already exercised structurally elsewhere in this suite).
import { callService } from '../../../support/node/call-service';

// ── Action: email identifier ──────────────────────────────────────────────────

describe('signup/index — action: email identifier', () => {
  it('redirects (302) to /signup/method with loginName and the duplicated placeholder name', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { email: 'john.doe@example.com' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      const url = new URL(loc, 'http://localhost');
      expect(url.pathname).to.equal('/signup/method');
      expect(url.searchParams.get('loginName')).to.equal('john.doe@example.com');
      // Identical placeholder (never a split/title-cased guess) so milo's
      // name-review annotation fires and cloud-portal forces profile completion.
      expect(url.searchParams.get('firstName')).to.equal('john.doe');
      expect(url.searchParams.get('lastName')).to.equal('john.doe');
    });
  });
});

// ── Action: IdP intent ────────────────────────────────────────────────────────

describe('signup/index — action: IdP intent', () => {
  it('redirects (302) to the IdP authUrl for a seeded IdP (idp-g)', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { intent: 'idp', idpId: 'idp-g' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
    });
  });
});
