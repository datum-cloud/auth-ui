// cypress/component/resources/authorize/stale-grant-callback.cy.ts
//
// Regression coverage for the post-logout STALE OIDC GRANT bug: after RP-initiated logout
// (cloud-portal), auth-ui's `sessions` cookie can hold a session whose Zitadel SESSION is still
// alive but whose OIDC GRANT is gone. getSession succeeds (so healIfSessionDead's dead-session
// check never fires) and the flow proceeds to createCallback, which Zitadel rejects with
// FAILED_PRECONDITION (confirmed in staging logs) — or ALREADY_DONE, the sibling code the same
// gRPC FailedPrecondition maps to depending on Zitadel's error message (see mappers.ts). Before
// the fix, ANY createCallback failure dead-ended on `signin_failed`; now DEAD_CALLBACK_CODES
// self-heals (prune + /login) exactly like the already-covered dead-session case in logout.cy.ts,
// while a genuinely transient/unknown code (e.g. UNAVAILABLE) still surfaces the error page.
//
// Node-bound: resolveAuthorize reads a real signed `sessions` cookie off a Request (Fetch spec
// forbids a Cookie header in the browser), so this runs through the cy.task node-spec harness.
import { callService, type AuditEvent } from '../../../support/node/call-service';

const SESSION = { id: 'sess-stale-grant-1', token: 'tok-stale-grant-1' };
const COOKIE = [{ id: SESSION.id, token: SESSION.token, loginName: 'alice@acme.test' }];

function authRequestSeed() {
  return { authRequests: { req1: { id: 'req1', clientId: 'client1', scopes: [], prompt: [] } } };
}

describe('resolveOidc — stale OIDC grant after logout (createCallback failure on an ALIVE session)', () => {
  it('FAILED_PRECONDITION self-heals to /login (prunes the stale entry) — NOT signin_failed', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: authRequestSeed(),
      liveSessions: [SESSION],
      callbackResults: { [SESSION.id]: { mode: 'throw', code: 'FAILED_PRECONDITION' } },
      request: {
        url: 'http://localhost/id/authorize?authRequest=req1',
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include('requestId=oidc_req1');
      expect(loc).to.not.include('/error');
      expect(loc).to.not.include('client.acme.test/callback');
      // Stale entry pruned from the re-signed cookie (same self-heal shape as the dead-session case).
      expect(v.response?.cookieEntries?.some((e) => e.id === SESSION.id) ?? false).to.equal(false);
      // Traceable self-heal event — proves this took the heal path, not a bare error redirect.
      const stale = v.audit.find((e: AuditEvent) => e.event === 'session_stale');
      expect(stale !== undefined, 'session_stale event').to.equal(true);
      expect(stale?.outcome).to.equal('success');
      expect(stale?.sessionId).to.equal(SESSION.id);
      // The failed createCallback attempt is still logged (diagnosability), just no longer terminal.
      const failure = v.audit.find(
        (e: AuditEvent) => e.event === 'oidc_callback' && e.outcome === 'failure'
      );
      expect(failure !== undefined, 'oidc_callback failure event').to.equal(true);
      expect(failure?.code).to.equal('FAILED_PRECONDITION');
    });
  });

  it('ALREADY_DONE (the sibling code for the same underlying gRPC FailedPrecondition) also self-heals to /login', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: authRequestSeed(),
      liveSessions: [SESSION],
      callbackResults: { [SESSION.id]: { mode: 'throw', code: 'ALREADY_DONE' } },
      request: {
        url: 'http://localhost/id/authorize?authRequest=req1',
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.not.include('/error');
    });
  });

  it('a TRANSIENT createCallback failure (UNAVAILABLE) on an alive session still surfaces signin_failed — no silent re-login', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: authRequestSeed(),
      liveSessions: [SESSION],
      callbackResults: { [SESSION.id]: { mode: 'throw', code: 'UNAVAILABLE' } },
      request: {
        url: 'http://localhost/id/authorize?authRequest=req1',
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/error');
      expect(loc).to.include('code=signin_failed');
      expect(loc).to.not.include('/login');
      expect(v.audit.some((e: AuditEvent) => e.event === 'session_stale')).to.equal(false);
    });
  });
});
