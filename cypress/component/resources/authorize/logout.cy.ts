// cypress/component/resources/authorize/logout.cy.ts
//
// cy.task node-spec port of app/resources/authorize/__tests__/logout.test.ts. The SUT reads a
// signed `sessions` cookie off the Request and self-heals stale post-logout sessions before
// reusing them in createCallback — logic that cannot run as a browser component spec (the Fetch
// spec forbids a Cookie request header). The harness runs the REAL resolveAuthorize +
// outcomeToResponse + cookie + audit in Bun (see cypress/support/node/*); we assert browser-side.
//
// Regression coverage for the post-logout stale-cookie bug (validate-before-reuse): dead →
// /login + session_stale (self-heal); transient → /error (NOT a silent re-login — the crux of
// the fix is not conflating a transient lookup failure with a genuinely dead session).
import { callService, type AuditEvent } from '../../../support/node/call-service';

const RAW_ID = 'cb'; // singleton seed: requestId `cb` has prompt:[] → OIDC callback path

function find(audit: AuditEvent[], pred: (e: AuditEvent) => boolean) {
  return audit.find(pred);
}

describe('/authorize — stale-cookie self-heal (validate before reuse)', () => {
  it('dead session (getSession→null) re-prompts /login, drops the stale entry, logs session_stale — NOT /id/error', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      sessionResults: { 'stale-b': { mode: 'null' } },
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}`,
        sessions: [{ id: 'stale-b', token: 'tok-stale', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include(`requestId=oidc_${RAW_ID}`);
      expect(loc).to.not.include('/error');
      // Stale entry pruned from the re-signed cookie.
      expect(v.response?.cookieEntries?.some((e) => e.id === 'stale-b') ?? false).to.equal(false);
      // DISTINCT, traceable audit event.
      const stale = find(v.audit, (e) => e.event === 'session_stale');
      expect(stale !== undefined, 'session_stale event').to.equal(true);
      expect(stale?.outcome).to.equal('success');
      expect(stale?.sessionId).to.equal('stale-b');
      // No oidc_callback failure for a self-heal.
      expect(v.audit.some((e) => e.event === 'oidc_callback' && e.outcome === 'failure')).to.equal(
        false
      );
    });
  });

  it('transient getSession error (UNAVAILABLE) does NOT log the user out — surfaces the error path', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      sessionResults: { transient: { mode: 'throw', code: 'UNAVAILABLE' } },
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}&sessionId=transient`,
        sessions: [{ id: 'transient', token: 'tok-transient', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.not.include('/login');
      expect(loc).to.include('/error');
      expect(v.audit.some((e) => e.event === 'session_stale')).to.equal(false);
    });
  });
});
