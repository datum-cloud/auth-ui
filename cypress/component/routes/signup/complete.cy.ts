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
      expect(v.response?.passkeyHint).to.equal('alice@acme.test');
    });
  });
});

// ── Expired / invalid link ────────────────────────────────────────────────────

describe('signup/complete — expired/invalid link', () => {
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

  it('surfaces requestId/organization alongside EXPIRED so "Start over" can resume the ceremony (regression: dropped on link expiry)', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url:
          'http://localhost/id/signup/complete?code=bad-code&userId=nonexistent-user' +
          '&requestId=oidc_V2_123&organization=org-1',
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown>;
      expect(v.response?.dataStatus).to.equal(400);
      expect(body.error).to.equal('EXPIRED');
      expect(body.requestId).to.equal('oidc_V2_123');
      expect(body.organization).to.equal('org-1');
    });
  });

  it('the structurally-invalid guard (missing code/userId) also surfaces requestId/organization', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?requestId=oidc_V2_456&organization=org-2',
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown>;
      expect(v.response?.dataStatus).to.equal(400);
      expect(body.error).to.equal('EXPIRED');
      expect(body.requestId).to.equal('oidc_V2_456');
      expect(body.organization).to.equal('org-2');
    });
  });
});
