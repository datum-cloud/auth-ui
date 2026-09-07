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
    // NOT alice@acme.test: that address is pre-seeded on the fake singleton (u1), and
    // register() now rejects duplicates with ALREADY_EXISTS like the real provider (D-FAKE).
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?next=passkey',
        form: { registerEmail: 'signup-fresh@acme.test', firstName: 'Alice', lastName: 'Smith' },
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      const url = new URL(loc, 'http://localhost');
      expect(url.pathname).to.equal('/setup/passkey');
      expect(url.searchParams.get('loginName')).to.equal('signup-fresh@acme.test');
      expect(url.searchParams.get('userId')).to.be.ok;
      expect(v.response?.passkeyHint).to.equal('signup-fresh@acme.test');
    });
  });

  // REGRESSION GUARD for the post-enrollment dead end, and for how it was finally resolved.
  //
  // This redirect originally carried NO returnTo and checkAfter=false, so after the passkey was
  // registered the routing fell through to nextStep — which found no fresh primary factor (the
  // session this loader mints holds only an otpEmail factor, and primaryFresh does not count it)
  // and sent a brand-new passwordless user to /login/password, a password they never set.
  //
  // checkAfter=true was the first fix: assert the new passkey immediately to earn a primary
  // factor. It worked in principle but demanded a second biometric prompt seconds after the
  // first, and returned FAILED_PRECONDITION on staging. So enrollment now ends at
  // /signup/success, which tells the user their account is ready and links to /login.
  it('sends the user to the /signup/success terminal after enrollment, not into a second ceremony', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?next=passkey',
        form: { registerEmail: 'terminal@acme.test', firstName: 'Term', lastName: 'Inal' },
      },
    }).then((v) => {
      const url = new URL(v.response?.location ?? '', 'http://localhost');
      expect(url.searchParams.get('force'), 'force').to.equal('false');
      // No inline assertion: checkAfter must NOT re-arm the /login/passkey hand-off.
      expect(url.searchParams.get('checkAfter'), 'checkAfter').to.equal('false');
      const returnTo = url.searchParams.get('returnTo') ?? '';
      expect(returnTo, 'returnTo').to.contain('/signup/success');
      expect(returnTo, 'identity threaded onto the terminal').to.contain('terminal%40acme.test');
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

  // SECURITY REGRESSION GUARD. This loader briefly resolved `userId` (straight off the query
  // string, unauthenticated GET, and NOT covered by signupRateLimit — which matches POST only, and
  // only /id/signup, /id/signup/password, /id/signup/method) to a loginName and returned it in the
  // 400 body so "Start over" could prefill the address. That made the route an email-disclosure
  // oracle: ?code=anything&userId=<any valid id> handed back that account's mailbox. Presenting a
  // code is no claim to the address — any string lands on the same failure path — so the address
  // is not surfaced here at all. Start over drops back to /signup without a prefill.
  it('never discloses the account address for a supplied userId', () => {
    callService({
      fn: 'signupCompleteLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/complete?code=bad&userId=u1&next=passkey',
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown>;
      expect(v.response?.dataStatus).to.equal(400);
      expect(body.error).to.equal('EXPIRED');
      expect(body.email, 'no address in the failure body').to.equal(undefined);
      // Belt and braces: nothing else in the body may carry the address either.
      expect(JSON.stringify(body)).to.not.contain('@');
    });
  });
});
