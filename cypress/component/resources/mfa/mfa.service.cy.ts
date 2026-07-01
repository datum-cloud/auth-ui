// cypress/component/resources/mfa/mfa.service.cy.ts
//
// cy.task node-spec port of the SESSION-BOUND mfa service tests:
//   - choose-mfa-method.service.test.ts  (chooseMfaMethod findUser-failure audit)
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
