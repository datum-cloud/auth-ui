// cypress/component/resources/authorize/org-scoped-self-heal.cy.ts
//
// Regression coverage for an ORG-PINNED auth request (`urn:zitadel:iam:org:id:<id>` scope) that
// reaches the session-reuse branch of /authorize with a cookie session it cannot finalize.
//
// Observed in staging (auth-ui#140 thread): the staff portal pins its login to a Zitadel org.
// After the staff portal's RP-initiated logout, auth-ui's `sessions` cookie still holds the dead
// entry, so the next org-pinned authorize self-healed to `/login?requestId=…` and DROPPED the
// organization. The login page then rendered the DEFAULT org's IdPs for a request Zitadel would
// only ever finalize on the pinned org. Clearing cookies "fixed" it because the no-session branch
// (decideAuthorize) threads the org, while the heal path rebuilt the URL from scratch.
//
// The third case is a CROSS-ORG session: a live session whose user belongs to a different org
// than the request pins. Zitadel rejects that callback with FAILED_PRECONDITION
// (Errors.User.NotAllowedOrg), indistinguishable BY CODE from the stale-grant case that
// stale-grant-callback.cy.ts covers — so a perfectly valid session used to be pruned as "stale".
// The org is now checked BEFORE createCallback: a mismatch routes to /login on the pinned org,
// leaves the session intact, and emits a distinct session_org_mismatch event.
//
// Node-bound (real signed `sessions` cookie on the Request) → cy.task node-spec harness.
import { callService, type AuditEvent } from '../../../support/node/call-service';

const ORG = '777001'; // Zitadel org ids are numeric — the org-id scope regex only accepts digits
const ORG_SCOPE = `urn:zitadel:iam:org:id:${ORG}`;
const SESSION = { id: 'sess-org-1', token: 'tok-org-1' };
const COOKIE = [{ id: SESSION.id, token: SESSION.token, loginName: 'alice@acme.test' }];
const OTHER_ORG_USER = { id: 'u-alice', loginName: 'alice@acme.test', orgId: '777002' };

function orgScopedSeed() {
  return {
    authRequests: {
      req1: { id: 'req1', clientId: 'client1', scopes: [ORG_SCOPE], prompt: [] },
    },
  };
}

function has(audit: AuditEvent[], event: string, outcome?: 'success' | 'failure') {
  return audit.find((e) => e.event === event && (outcome === undefined || e.outcome === outcome));
}

/**
 * True when the cookie was not rewritten, or was rewritten with the entry still in it.
 * The harness sets `cookieEntries` to null ONLY when the response carried no `sessions=`
 * Set-Cookie (harness.ts). The request's own cookie already holds SESSION.id, so "no rewrite"
 * means the browser keeps sending the original entry — i.e. nothing was pruned.
 */
function sessionKept(v: { response?: { cookieEntries?: Array<{ id: string }> | null } }) {
  const entries = v.response?.cookieEntries;
  return entries == null || entries.some((e) => e.id === SESSION.id);
}

describe('resolveOidc — org-pinned auth request meets a cookie session it cannot reuse', () => {
  it('dead session (getSession→null): the /login self-heal keeps the organization from the scope', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: orgScopedSeed(),
      sessionResults: { [SESSION.id]: { mode: 'null' } },
      request: {
        url: 'http://localhost/id/authorize?authRequest=req1',
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include('requestId=oidc_req1');
      expect(loc, 'organization threaded through the self-heal').to.include(`organization=${ORG}`);
      expect(loc).to.not.include('/error');
      // Same heal shape as logout.cy.ts: the dead entry is pruned and the heal is traceable.
      expect(v.response?.cookieEntries?.some((e) => e.id === SESSION.id) ?? false).to.equal(false);
      expect(has(v.audit, 'session_stale', 'success')?.sessionId).to.equal(SESSION.id);
    });
  });

  it('stale grant (createCallback→FAILED_PRECONDITION): the /login self-heal keeps the organization', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: orgScopedSeed(),
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
      expect(loc, 'organization threaded through the self-heal').to.include(`organization=${ORG}`);
      expect(loc).to.not.include('/error');
      expect(v.response?.cookieEntries?.some((e) => e.id === SESSION.id) ?? false).to.equal(false);
      expect(has(v.audit, 'session_stale', 'success')?.sessionId).to.equal(SESSION.id);
    });
  });

  it('live session in ANOTHER org: routes to /login on the pinned org WITHOUT calling createCallback or pruning the session', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: orgScopedSeed(),
      liveSessions: [{ ...SESSION, user: OTHER_ORG_USER }],
      request: {
        url: 'http://localhost/id/authorize?authRequest=req1',
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include('requestId=oidc_req1');
      expect(loc, 'login page pinned to the request org').to.include(`organization=${ORG}`);
      expect(loc).to.not.include('/error');
      expect(loc).to.not.include('client.acme.test/callback');
      // The session is valid for other clients (the cloud portal): it must NOT be pruned, and
      // must NOT be mistaken for the stale-grant case.
      expect(sessionKept(v), 'session left intact').to.equal(true);
      expect(has(v.audit, 'session_stale'), 'no session_stale').to.equal(undefined);
      // createCallback was never attempted — no oidc_callback success OR failure.
      expect(has(v.audit, 'oidc_callback'), 'no oidc_callback event').to.equal(undefined);
      const mismatch = has(v.audit, 'session_org_mismatch', 'success');
      expect(mismatch !== undefined, 'session_org_mismatch event').to.equal(true);
      expect(mismatch?.sessionId).to.equal(SESSION.id);
      expect(mismatch?.requestId).to.equal('req1');
    });
  });

  it('live session in ANOTHER org handed back explicitly (?sessionId=): same /login-on-pinned-org outcome, session intact', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: orgScopedSeed(),
      liveSessions: [{ ...SESSION, user: OTHER_ORG_USER }],
      request: {
        url: `http://localhost/id/authorize?authRequest=req1&sessionId=${SESSION.id}`,
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include(`organization=${ORG}`);
      expect(loc).to.not.include('client.acme.test/callback');
      expect(sessionKept(v), 'session left intact').to.equal(true);
      expect(has(v.audit, 'oidc_callback'), 'no oidc_callback event').to.equal(undefined);
      expect(has(v.audit, 'session_org_mismatch', 'success')?.sessionId).to.equal(SESSION.id);
    });
  });

  // Guard against over-blocking: with NO org scope (the cloud portal), Zitadel performs no org
  // check, so a session from any org is reusable and the callback must still proceed.
  it('no org scope: a live session from any org is reused and the callback proceeds', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'fresh',
      seed: {
        authRequests: { req1: { id: 'req1', clientId: 'client1', scopes: [], prompt: [] } },
      },
      liveSessions: [{ ...SESSION, user: OTHER_ORG_USER }],
      request: {
        url: 'http://localhost/id/authorize?authRequest=req1',
        sessions: COOKIE,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('client.acme.test/callback');
      expect(has(v.audit, 'session_org_mismatch'), 'no mismatch event').to.equal(undefined);
      expect(has(v.audit, 'oidc_callback', 'success')?.sessionId).to.equal(SESSION.id);
    });
  });
});
