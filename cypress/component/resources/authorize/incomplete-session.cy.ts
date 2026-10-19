// cypress/component/resources/authorize/incomplete-session.cy.ts
//
// A session with no primary factor must never finalize an auth request.
//
// Zitadel's LinkSessionToAuthRequest checks only that the session is alive and the token is
// valid — it does not look at factors, and leaves that policy to the login UI. Passkey signup
// mints exactly such a session: otpEmail alone, held in the cookie while the user is still on
// /setup/passkey. Before this gate, a plain /authorize (no prompt — what cloud-portal sends)
// reused it as the most recent session and signed the user in without a passkey (confirmed on
// staging). The session is NOT pruned: the signup tab still needs it to finish enrolment.
//
// Node-bound: resolveAuthorize reads a real signed `sessions` cookie off a Request.
import { callService, type AuditEvent } from '../../../support/node/call-service';

const SIGNUP = { id: 'sess-signup-1', token: 'tok-signup-1' };
const COOKIE = [{ id: SIGNUP.id, token: SIGNUP.token, loginName: 'new@acme.test' }];

function authRequestSeed() {
  return { authRequests: { req1: { id: 'req1', clientId: 'client1', scopes: [], prompt: [] } } };
}

function expectLoginWithoutCallback(v: {
  response?: { status?: number; location?: string; cookieEntries?: Array<{ id: string }> | null };
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
  // Not pruned: no re-signed cookie is written at all.
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
