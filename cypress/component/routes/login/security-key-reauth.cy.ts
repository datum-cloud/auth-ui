// cypress/component/routes/login/security-key-reauth.cy.ts
//
// cy.task port of app/routes/login/__tests__/security-key-reauth.test.ts.
// H-1: the webauthn verify route's re-auth identity guard exercised at the HTTP boundary.
// FakeAuthProvider accepts credential='{}' (valid JSON, min(1)) without real FIDO2 validation.
import { callService } from '../../../support/node/call-service';

const ALICE = 'alice@acme.test';
const SESSION = { id: 's1', token: 't1', loginName: ALICE };

describe('login/security-key (webauthn) action — re-auth identity guard (H-1)', () => {
  it('different identity → bounces to /accounts?reauthMismatch=1 (carrying requestId), clears intent', () => {
    // form loginName = alice, reauthIntent = totp-user → mismatch
    callService({
      fn: 'securityKeyAction',
      provider: 'singleton',
      liveSessions: [{ id: 's1', token: 't1', user: { id: 'u1', loginName: ALICE } }],
      request: {
        url: 'http://localhost/id/login/security-key',
        sessions: [SESSION],
        form: { loginName: ALICE, credential: '{}', requestId: 'oidc_x' },
        csrf: true,
        reauthIntent: 'totp-user@acme.test',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.contain('/accounts');
      expect(loc).to.contain('reauthMismatch=1');
      expect(loc).to.contain('requestId=oidc_x');
      expect(v.response?.setCookies?.some((c: string) => c.startsWith('reauth-intent='))).to.equal(
        true
      );
    });
  });
});
