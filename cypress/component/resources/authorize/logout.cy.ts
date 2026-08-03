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
import { callService, type AuditEvent, type Scenario } from '../../../support/node/call-service';

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

// Read-after-write retry (Zitadel eventual consistency): a session THIS request just created
// (the post-register /authorize handback is the concrete case) can transiently 404 on getSession
// if the read lands on a replica that hasn't caught up with the write yet. healIfSessionDead
// re-probes with a bounded increasing backoff (stopping the instant it comes back alive) — but
// ONLY when the cookie entry's creationTs is fresh — before treating a dead code as ground truth.
// See authorize.service.ts's RETRY_FRESHNESS_WINDOW_MS block for the full scoping rationale.
describe('/authorize — read-after-write retry on a freshly-created session (NOT_FOUND)', () => {
  const NOW_MS = Date.parse('2026-06-24T12:00:00.000Z');

  it('FRESH session (creationTs within the retry window): NOT_FOUND then alive → the bounded backoff keeps polling until the replica catches up and finalizes the callback (no self-heal)', () => {
    // Each row scripts N failing getSession reads before falling through to the seeded live
    // session — "the write landed, the read(s) just raced a lagging replica". Distinct session
    // ids per row keep the singleton provider's scripted results independent.
    const ROWS: ReadonlyArray<{
      label: string;
      id: string;
      script: NonNullable<Scenario['sessionResults']>[string];
    }> = [
      {
        // Consumed by the FIRST getSession call; the retry then finds the live session (this is
        // the "just redirected back from register" case).
        label: 'replica lags one read cycle',
        id: 'fresh-race-1',
        script: { mode: 'throw-once', code: 'NOT_FOUND' },
      },
      {
        // Throws NOT_FOUND for the first TWO getSession calls (the initial probe + the first
        // retry), then falls through on the third — a replica that lags past a single retry.
        // Proves healIfSessionDead's loop keeps going instead of giving up after one attempt.
        label: 'replica lags two read cycles',
        id: 'fresh-race-2',
        script: { mode: 'throw-times', code: 'NOT_FOUND', times: 2 },
      },
    ];

    ROWS.forEach(({ label, id, script }) => {
      callService({
        fn: 'resolveAuthorize',
        provider: 'singleton',
        liveSessions: [{ id, token: `tok-${id}` }],
        sessionResults: { [id]: script },
        nowMs: NOW_MS,
        request: {
          url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}&sessionId=${id}`,
          sessions: [
            {
              id,
              token: `tok-${id}`,
              loginName: 'alice@acme.test',
              // 2s old — well inside the retry window.
              creationTs: new Date(NOW_MS - 2000).toISOString(),
            },
          ],
        },
      }).then((v) => {
        expect(v.response?.status, `${label}: 302`).to.equal(302);
        const loc = v.response?.location ?? '';
        expect(loc, `${label}: callback host`).to.include('client.acme.test/callback');
        expect(loc, `${label}: minted code`).to.include(`code=fake_${RAW_ID}_${id}`);
        expect(loc, `${label}: no /login re-prompt`).to.not.include('/login');
        // No self-heal fired — the retry recovered the session, so it must NOT look like the
        // stale-cookie case above.
        expect(
          v.audit.some((e) => e.event === 'session_stale'),
          `${label}: no session_stale`
        ).to.equal(false);
      });
    });
  });

  it('FRESH session that stays dead through ALL backoffs: NOT_FOUND on every probe → the loop is exhausted and falls through to the /login self-heal (session_stale)', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      // Throws NOT_FOUND on EVERY getSession — the replica never catches up. Proves the bounded
      // loop terminates (a for…of over a fixed tuple can't hang) and lands on the documented
      // dead-code self-heal fall-through, rather than looping forever or reusing a dead session.
      sessionResults: { 'fresh-race-3': { mode: 'throw', code: 'NOT_FOUND' } },
      nowMs: NOW_MS,
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}&sessionId=fresh-race-3`,
        sessions: [
          {
            id: 'fresh-race-3',
            token: 'tok-fresh-race-3',
            loginName: 'alice@acme.test',
            // 2s old — inside the retry window, so the loop DOES run (and exhausts).
            creationTs: new Date(NOW_MS - 2000).toISOString(),
          },
        ],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.include(`requestId=oidc_${RAW_ID}`);
      expect(loc).to.not.include('/callback');
      // Exhausted retry self-heals: emit session_stale and prune the dead entry from the cookie.
      expect(v.audit.some((e) => e.event === 'session_stale')).to.equal(true);
      expect(v.response?.cookieEntries?.some((e) => e.id === 'fresh-race-3') ?? false).to.equal(
        false
      );
    });
  });

  it('OLD session (creationTs outside the retry window): NOT_FOUND self-heals immediately — no retry, anti-forgery preserved', () => {
    callService({
      fn: 'resolveAuthorize',
      provider: 'singleton',
      // Deliberately seeded so the retry WOULD succeed if it fired — proves the freshness gate,
      // not merely "the session doesn't exist", is what's blocking the retry here.
      liveSessions: [{ id: 'old-race-1', token: 'tok-old-race-1' }],
      sessionResults: { 'old-race-1': { mode: 'throw-once', code: 'NOT_FOUND' } },
      nowMs: NOW_MS,
      request: {
        url: `http://localhost/id/authorize?requestId=oidc_${RAW_ID}&sessionId=old-race-1`,
        sessions: [
          {
            id: 'old-race-1',
            token: 'tok-old-race-1',
            loginName: 'alice@acme.test',
            // 60s old — well outside RETRY_FRESHNESS_WINDOW_MS (5s): an old/stale/forged entry.
            creationTs: new Date(NOW_MS - 60_000).toISOString(),
          },
        ],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      expect(loc).to.include('/login');
      expect(loc).to.not.include('client.acme.test/callback');
      const stale = find(v.audit, (e) => e.event === 'session_stale');
      expect(stale !== undefined, 'session_stale event (immediate self-heal, no retry)').to.equal(
        true
      );
      expect(stale?.sessionId).to.equal('old-race-1');
    });
  });
});
