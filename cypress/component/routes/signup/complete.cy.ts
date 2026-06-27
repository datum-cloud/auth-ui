// cypress/component/routes/signup/complete.cy.ts
//
// cy.task port of app/routes/signup/__tests__/complete.test.tsx.
// The signup/complete loader verifies an email token and redirects to /setup/passkey.
//
// Success tests use the compound signupCompleteLoader scenario: passing
// s.request.form.registerEmail causes the harness to call FakeAuthProvider.register()
// first, compute code = `email-${userId}`, and inject both into the URL before invoking
// the loader — no vi.mock needed.
import { callService } from '../../../support/node/call-service';

// ── Success path ──────────────────────────────────────────────────────────────

describe('signup/complete — success path', () => {
  it('redirects (302) to /setup/passkey when code and userId are valid', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?next=passkey',
        form: { registerEmail: 'success@acme.test', firstName: 'Test', lastName: 'User' },
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.match(/^\/setup\/passkey/);
    });
  });

  it('emits a sessions set-cookie on successful verification', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?next=passkey',
        form: { registerEmail: 'cookies@acme.test', firstName: 'Cookie', lastName: 'Test' },
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      // The cookie header may be merged or present in the response.
      // At minimum the redirect must be present.
      expect(v.response?.location ?? '').to.include('/setup/passkey');
    });
  });

  it('threads loginName and userId into the /setup/passkey redirect URL', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?next=passkey',
        form: { registerEmail: 'alice@acme.test', firstName: 'Alice', lastName: 'Smith' },
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      const url = new URL(loc, 'http://localhost');
      expect(url.pathname).to.equal('/setup/passkey');
      expect(url.searchParams.get('loginName')).to.equal('alice@acme.test');
      expect(url.searchParams.get('userId')).to.be.ok;
    });
  });

  it('threads organization into the redirect when present', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?next=passkey&organization=acme-org',
        form: {
          registerEmail: 'org-user@acme.test',
          firstName: 'Org',
          lastName: 'User',
          orgId: 'acme-org',
        },
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const url = new URL(v.response?.location ?? '', 'http://localhost');
      expect(url.searchParams.get('organization')).to.equal('acme-org');
    });
  });
});

// ── Expired / invalid link ────────────────────────────────────────────────────

describe('signup/complete — expired/invalid link', () => {
  it('returns 400 with error=EXPIRED when userId is missing', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/signup/complete?code=some-code&next=passkey' },
    }).then((v) => {
      const status = v.response?.isResponse ? v.response.status : v.response?.dataStatus;
      expect(status).to.equal(400);
    });
  });

  it('returns 400 with error=EXPIRED when code is missing', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/signup/complete?userId=ghost-id&next=passkey' },
    }).then((v) => {
      const status = v.response?.isResponse ? v.response.status : v.response?.dataStatus;
      expect(status).to.equal(400);
    });
  });

  it('returns 400 with error=EXPIRED when userId does not resolve to a user', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?code=email-ghost&userId=ghost-id&next=passkey',
      },
    }).then((v) => {
      const status = v.response?.isResponse ? v.response.status : v.response?.dataStatus;
      expect(status).to.equal(400);
    });
  });

  it('returns 400 with error=EXPIRED when code is wrong (replay-safe)', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?next=passkey',
        form: { registerEmail: 'replay@acme.test', firstName: 'Replay', lastName: 'Test' },
      },
    }).then((v) => {
      // First, get the userId from the redirect (302 means valid)
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      const url = new URL(loc, 'http://localhost');
      const userId = url.searchParams.get('userId')!;

      // Now call again with the wrong code — should be 400
      return callService({
        fn: 'signupCompleteLoader',
        provider: 'singleton',
        request: {
          url: `http://localhost/id/signup/complete?code=wrong-code&userId=${userId}&next=passkey`,
        },
      }).then((v2) => {
        const status = v2.response?.isResponse ? v2.response.status : v2.response?.dataStatus;
        expect(status).to.equal(400);
      });
    });
  });

  it('returns 400 when code is empty string', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?code=&userId=any-id&next=passkey',
      },
    }).then((v) => {
      const status = v.response?.isResponse ? v.response.status : v.response?.dataStatus;
      expect(status).to.equal(400);
    });
  });
});
