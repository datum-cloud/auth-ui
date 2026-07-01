// cypress/component/resources/authorize/oidc-handback.cy.ts
//
// cy.task node-spec port of app/resources/authorize/__tests__/oidc-handback.test.ts.
// Drives resolveAuthorize with a LIVE signed-cookie session (node-bound) to lock the
// SECURITY behaviour: the prompt=login freshness gate — a STALE handed-back session must NOT
// finalize a prompt=login ceremony (forced re-auth), while a FRESH one does.
//
// The freshness cases need a session with a CONTROLLABLE password.verifiedAt (the shared fake
// hardcodes it to FIXED_NOW). The harness expresses this via an instance getSession override
// (`freshness`) — the cy.task equivalent of the original test's FreshnessProvider subclass.
import { callService } from '../../../support/node/call-service';

const SESSION = { id: 'sess-live-1', token: 'tok-live-1' };
const NOW_MS = Date.parse('2026-06-24T12:00:00.000Z');
const TEN_MIN_MS = 10 * 60 * 1000;
const FIVE_SEC_MS = 5 * 1000;

function authRequestSeed(prompt: string[]) {
  return { authRequests: { req1: { id: 'req1', clientId: 'client1', scopes: [], prompt } } };
}

const COOKIE = [{ id: SESSION.id, token: SESSION.token, loginName: 'alice@acme.test' }];

describe('resolveOidc — prompt=login freshness gate (anti-forgery hardening)', () => {
  it('prompt=login + STALE handed-back session → does NOT finalize; routes to /login (re-auth)', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: authRequestSeed(['login']),
      freshness: { sessionId: SESSION.id, token: SESSION.token, verifiedAtMs: NOW_MS - TEN_MIN_MS },
      nowMs: NOW_MS,
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_req1&sessionId=${SESSION.id}`,
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.not.include('client.acme.test/callback');
      expect(loc).to.not.include('code=');
      expect(loc).to.include('/login');
      expect(loc).to.include('requestId=oidc_req1');
    });
  });

  it('prompt=login + FRESH handed-back session → finalizes the callback (legitimate login)', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: authRequestSeed(['login']),
      freshness: {
        sessionId: SESSION.id,
        token: SESSION.token,
        verifiedAtMs: NOW_MS - FIVE_SEC_MS,
      },
      nowMs: NOW_MS,
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_req1&sessionId=${SESSION.id}`,
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('client.acme.test/callback');
      expect(loc).to.include(`code=fake_req1_${SESSION.id}`);
      expect(loc).to.not.include('/login');
    });
  });
});
