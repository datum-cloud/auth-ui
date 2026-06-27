// cypress/component/resources/authorize/logout.cy.ts
//
// cy.task node-spec port of app/resources/authorize/__tests__/logout.test.ts. The SUT reads a
// signed `sessions` cookie off the Request and self-heals stale post-logout sessions before
// reusing them in createCallback — logic that cannot run as a browser component spec (the Fetch
// spec forbids a Cookie request header). The harness runs the REAL resolveAuthorize +
// outcomeToResponse + cookie + audit in Bun (see cypress/support/node/*); we assert browser-side.
//
// Regression coverage for the post-logout stale-cookie bug (validate-before-reuse): dead →
// /login + session_stale; transient → /error (NOT a silent re-login); live → unchanged.
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

  it('dead session (getSession throws NOT_FOUND) on the explicit sessionId path re-prompts /login + drops entry', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      sessionResults: { 'stale-a': { mode: 'throw', code: 'NOT_FOUND' } },
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}&sessionId=stale-a`,
        sessions: [{ id: 'stale-a', token: 'tok-stale-a', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include(`requestId=oidc_${RAW_ID}`);
      expect(loc).to.not.include('/error');
      expect(v.response?.cookieEntries?.some((e) => e.id === 'stale-a') ?? false).to.equal(false);
    });
  });

  it('dead session (getSession throws PERMISSION_DENIED) is treated as dead → /login', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      sessionResults: { 'stale-perm': { mode: 'throw', code: 'PERMISSION_DENIED' } },
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}&sessionId=stale-perm`,
        sessions: [{ id: 'stale-perm', token: 'tok-perm', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.not.include('/error');
    });
  });

  it('live session → createCallback runs → 302 to the callback URL (happy path unchanged)', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      liveSessions: [{ id: 'live-ok', token: 'tok-live-ok' }],
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}&sessionId=live-ok`,
        sessions: [{ id: 'live-ok', token: 'tok-live-ok', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('client.acme.test/callback');
      expect(loc).to.include(`fake_${RAW_ID}_live-ok`);
      expect(loc).to.not.include('/login');
      expect(loc).to.not.include('/error');
    });
  });

  it('live session + createCallback throws ALREADY_DONE → STILL redirects to /id/error (genuine error NOT masked)', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      liveSessions: [{ id: 'live-already', token: 'tok-live-already' }],
      callbackResults: { 'live-already': { mode: 'throw', code: 'ALREADY_DONE' } },
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}&sessionId=live-already`,
        sessions: [{ id: 'live-already', token: 'tok-live-already', loginName: 'alice@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/error');
      expect(loc).to.not.include('/login');
      const failure = find(v.audit, (e) => e.event === 'oidc_callback' && e.outcome === 'failure');
      expect(failure !== undefined, 'oidc_callback failure').to.equal(true);
      expect(failure?.code).to.equal('ALREADY_DONE');
      // Must NOT have self-healed a live session.
      expect(v.audit.some((e) => e.event === 'session_stale')).to.equal(false);
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
