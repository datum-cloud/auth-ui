// cypress/component/resources/mfa/mfa.service.cy.ts
//
// cy.task node-spec port of the SESSION-BOUND mfa service tests:
//   - choose-mfa-method.service.test.ts  (chooseMfaMethod findUser-failure audit)
//   - resolve-mfa-picker.service.test.ts (resolveMfaPicker Bug C policy filtering)
//   - setup-mfa.service.test.ts          (resolveMfaSetup loader guards + gating)
//
// These read an already-read SessionEntry[] and emit REAL audit via logAuthEvent (→ console.log,
// captured by the harness). The browser bundle stubs observability to a no-op, so they must run
// node-side against the richly-seeded fake singleton (u1 alice, u7 mfa2-user, totp-only-org).
import { callService } from '../../../support/node/call-service';

describe('chooseMfaMethod — findUser failure audit (security: routing continues, no PII leak)', () => {
  const scenario = {
    fn: 'chooseMfaMethod' as const,
    provider: 'singleton' as const,
    failFindUser: true,
    request: {
      url: 'http://localhost/id/login/mfa',
      sessions: [{ id: 's1', token: 't1', loginName: 'alice@acme.test' }],
      form: { loginName: 'alice@acme.test', method: 'totp' },
    },
    mfaInput: { loginName: 'alice@acme.test' },
  };

  it('emits an mfa_method_chosen failure audit line when findUser throws', () => {
    callService(scenario).then((v) => {
      const failure = v.audit.find(
        (e) => e.event === 'mfa_method_chosen' && e.outcome === 'failure'
      );
      expect(failure, 'a failure audit event').to.not.equal(undefined);
    });
  });

  it('still emits the success routing event even when findUser throws (routing continues)', () => {
    callService(scenario).then((v) => {
      const success = v.audit.find(
        (e) => e.event === 'mfa_method_chosen' && e.outcome === 'success'
      );
      expect(success, 'the success routing event').to.not.equal(undefined);
      // routing still resolves a use-screen target.
      const o = v.outcome as { ok: boolean; target?: string };
      expect(o.ok).to.equal(true);
      expect(o.target ?? '').to.include('/login/verify/authenticator');
    });
  });

  it('does NOT put raw loginName in the failure audit fields (hashed actor only)', () => {
    callService(scenario).then((v) => {
      const failure = v.audit.find(
        (e) => e.event === 'mfa_method_chosen' && e.outcome === 'failure'
      );
      expect(failure?.loginName, 'no raw loginName').to.equal(undefined);
      expect(typeof failure?.actor, 'hashed actor present').to.equal('string');
    });
  });
});

describe('resolveMfaPicker — policy-aware second-factor filtering (Bug C / C4)', () => {
  it('drops a policy-disabled enrolled factor and short-circuits to the remaining allowed one', () => {
    // u7 (mfa2-user) enrolled in [password, totp, otp_email]; totp-only-org policy allows only
    // [totp] → intersection leaves TOTP → redirect straight to its use-screen.
    callService({
      fn: 'resolveMfaPicker',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login/mfa',
        sessions: [
          {
            id: 's1',
            token: 't1',
            loginName: 'mfa2-user@acme.test',
            organization: 'totp-only-org',
          },
        ],
      },
      mfaInput: { loginName: 'mfa2-user@acme.test', organization: 'totp-only-org' },
    }).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.target ?? '').to.include('/login/verify/authenticator');
    });
  });

  it('lists both enrolled factors when the policy does not restrict (secondFactors undefined)', () => {
    callService({
      fn: 'resolveMfaPicker',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login/mfa',
        sessions: [{ id: 's1', token: 't1', loginName: 'mfa2-user@acme.test' }],
      },
      mfaInput: { loginName: 'mfa2-user@acme.test' },
    }).then((v) => {
      const o = v.outcome as { kind: string; secondFactors?: string[] };
      expect(o.kind).to.equal('picker');
      expect(o.secondFactors).to.have.length(2);
      expect(o.secondFactors).to.include('totp');
      expect(o.secondFactors).to.include('otp_email');
    });
  });
});

describe('resolveMfaSetup — loader guards + gating', () => {
  it('redirects to /login when there is no session for the loginName', () => {
    callService({
      fn: 'resolveMfaSetup',
      provider: 'singleton',
      request: { url: 'http://localhost/id/setup/mfa' }, // no sessions
      mfaInput: { loginName: 'mfa2-user@acme.test' },
    }).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.target).to.equal('/login');
    });
  });

  it('redirects to /login when the user does not exist for a valid session', () => {
    callService({
      fn: 'resolveMfaSetup',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/setup/mfa',
        sessions: [{ id: 's1', token: 't1', loginName: 'ghost@acme.test' }],
      },
      mfaInput: { loginName: 'ghost@acme.test' },
    }).then((v) => {
      const o = v.outcome as { kind: string; target?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.target).to.equal('/login');
    });
  });

  it('returns the offerable enrollment keys (capability + policy gated) for a valid session+user', () => {
    // No org → capabilities-only gating. Singleton caps enable passkey/totpOtp/emailOtp.
    callService({
      fn: 'resolveMfaSetup',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/setup/mfa',
        sessions: [{ id: 's1', token: 't1', loginName: 'mfa2-user@acme.test' }],
      },
      mfaInput: { loginName: 'mfa2-user@acme.test' },
    }).then((v) => {
      const o = v.outcome as { kind: string; offerableKeys?: string[] };
      expect(o.kind).to.equal('setup');
      expect(o.offerableKeys).to.deep.equal(['passkey', 'totpOtp', 'emailOtp']);
    });
  });
});
