// cypress/component/resources/authorize/stale-grant-callback.cy.ts
//
// Regression coverage for the post-logout STALE OIDC GRANT bug: after RP-initiated logout
// (cloud-portal), auth-ui's `sessions` cookie can hold a session whose Zitadel SESSION is still
// alive but whose OIDC GRANT is gone. getSession succeeds (so healIfSessionDead's dead-session
// check never fires) and the flow proceeds to createCallback, which Zitadel rejects with
// FAILED_PRECONDITION (confirmed in staging logs). Before the fix, ANY createCallback failure
// dead-ended on `signin_failed`; now FAILED_PRECONDITION self-heals (prune + /login) exactly like
// the already-covered dead-session case in logout.cy.ts.
//
// IMPORTANT — ALREADY_DONE is NOT self-healed. mappers.ts maps a code-9 FailedPrecondition whose
// message matches /verified|already/i ("auth request already handled") to ALREADY_DONE, which is
// the DOUBLE-CALLBACK case: the SAME requestId re-submitted after it was already finalized (browser
// back+reload, duplicate tab), where the session is still valid. Self-healing there would prune a
// good session and re-thread the already-consumed requestId, risking a redirect loop — so
// ALREADY_DONE, like any transient/unknown code (e.g. UNAVAILABLE), surfaces the conservative
// signin_failed error page with the session left intact.
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

  it('ALREADY_DONE (double-callback: the same auth request re-submitted after it was already finalized) does NOT self-heal — surfaces signin_failed with the still-valid session left intact', () => {
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
      // Conservative error page, NOT a self-heal to /login: a double-callback must not destroy the
      // still-valid session or re-thread the already-consumed requestId (which risks a heal loop).
      expect(loc).to.include('/error');
      expect(loc).to.include('code=signin_failed');
      expect(loc).to.not.include('/login');
      // No self-heal event and no cookie prune — the valid session is preserved (no Set-Cookie rewrite).
      expect(v.audit.some((e: AuditEvent) => e.event === 'session_stale')).to.equal(false);
      // The failed createCallback is still logged for diagnosability, just no longer terminal-to-heal.
      const failure = v.audit.find(
        (e: AuditEvent) => e.event === 'oidc_callback' && e.outcome === 'failure'
      );
      expect(failure?.code).to.equal('ALREADY_DONE');
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
