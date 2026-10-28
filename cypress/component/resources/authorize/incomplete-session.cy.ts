// cypress/component/resources/authorize/incomplete-session.cy.ts
//
// A session with no primary factor (the otpEmail-only signup session) never finalizes.
import { callService, type AuditEvent } from '../../../support/node/call-service';

const SIGNUP = { id: 'sess-signup-1', token: 'tok-signup-1' };
const COOKIE = [{ id: SIGNUP.id, token: SIGNUP.token, loginName: 'new@acme.test' }];

function authRequestSeed() {
  return { authRequests: { req1: { id: 'req1', clientId: 'client1', scopes: [], prompt: [] } } };
}

function expectLoginWithoutCallback(v: {
  response?: {
    status?: number;
    location?: string | null;
    cookieEntries?: Array<{ id: string }> | null;
  };
  audit: AuditEvent[];
}) {
  expect(v.response?.status).to.equal(302);
  const loc = v.response?.location ?? '';
  expect(loc).to.include('/login');
  expect(loc).to.include('requestId=oidc_req1');
  expect(loc).to.not.include('client.acme.test/callback');
  expect(v.audit.some((e) => e.event === 'oidc_callback' && e.outcome === 'success')).to.equal(
    false
  );
  const refused = v.audit.find((e) => e.event === 'session_incomplete');
  expect(refused !== undefined, 'session_incomplete event').to.equal(true);
  expect(refused?.sessionId).to.equal(SIGNUP.id);
  expect(v.response?.cookieEntries ?? null).to.equal(null);
}

describe('/authorize — a session without a primary factor never finalizes', () => {
  it('default reuse path: an otpEmail-only most-recent session → /login, no createCallback', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: authRequestSeed(),
      liveSessions: [{ ...SIGNUP, factorKinds: ['otpEmail'] }],
      request: { url: 'http://localhost/id/authorize?authRequest=req1', sessions: COOKIE },
    }).then(expectLoginWithoutCallback);
  });

  it('explicit sessionId hand-back: the same session named in the URL → /login, no createCallback', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: authRequestSeed(),
      liveSessions: [{ ...SIGNUP, factorKinds: ['otpEmail'] }],
      request: {
        url: `http://localhost/id/authorize?authRequest=req1&sessionId=${SIGNUP.id}`,
        sessions: COOKIE,
      },
    }).then(expectLoginWithoutCallback);
  });

  it('a passkey-verified session still finalizes (the gate admits every primary factor)', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: authRequestSeed(),
      liveSessions: [{ ...SIGNUP, factorKinds: ['otpEmail', 'passkey'] }],
      request: { url: 'http://localhost/id/authorize?authRequest=req1', sessions: COOKIE },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const success = v.audit.find(
        (e: AuditEvent) => e.event === 'oidc_callback' && e.outcome === 'success'
      );
      expect(success?.sessionId).to.equal(SIGNUP.id);
    });
  });
});
