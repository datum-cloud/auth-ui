// cypress/component/resources/session/session.service.switch.cy.ts
//
// cy.task node-spec port of app/resources/session/__tests__/session.service.switch.test.ts.
// switchAccount/removeAccount read the signed `sessions` cookie off the Request, so they are
// node-bound. SECURITY: the CURRENT ceremony requestId must come from the form field (allowlisted),
// never the stale cookie one — and a non-allowlisted value (`evil_https://…` / `evil_x`) is dropped.
import { callService } from '../../../support/node/call-service';

const ALICE = { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' };

type Outcome = {
  kind: string;
  location?: string;
  error?: string;
  status?: number;
  cookies?: string[];
};

describe('switchAccount — 755-M10 MFA-setup nudge suppression', () => {
  it('switches a no-MFA user to /signed-in instead of the skippable /setup/mfa nudge', () => {
    callService({
      fn: 'switchAccount',
      seed: {
        users: [ALICE],
        authMethods: { u1: [] },
        settingsByOrg: { 'nudge-org': { mfaInitSkipLifetimeMs: 10_000 } },
      },
      liveSessions: [{ id: 's1', token: 'tok-s1', user: ALICE }],
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [
          { id: 's1', token: 'tok-s1', loginName: 'alice@acme.test', organization: 'nudge-org' },
        ],
        form: { intent: 'switch', sessionId: 's1' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.match(/^\/signed-in(\?|$)/);
      expect(o.location).to.not.include('/setup/mfa');
    });
  });

  it('still routes a forceMfa-org switch to forced /setup/mfa (real requirement preserved)', () => {
    const bob = { id: 'u2', loginName: 'bob@acme.test', displayName: 'Bob' };
    callService({
      fn: 'switchAccount',
      seed: {
        users: [bob],
        authMethods: { u2: [] },
        settingsByOrg: { 'force-org': { forceMfa: true } },
      },
      liveSessions: [{ id: 's2', token: 'tok-s2', user: bob }],
      request: {
        url: 'http://localhost/id/accounts',
        sessions: [
          { id: 's2', token: 'tok-s2', loginName: 'bob@acme.test', organization: 'force-org' },
        ],
        form: { intent: 'switch', sessionId: 's2' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.include('/setup/mfa');
      expect(o.location).to.include('force=true');
      expect(o.location).to.include('checkAfter=true');
    });
  });
});

describe('switchAccount — current ceremony requestId threading (datumctl OIDC hang)', () => {
  const nudge = {
    seed: {
      users: [ALICE],
      authMethods: { u1: [] },
      settingsByOrg: { 'nudge-org': { mfaInitSkipLifetimeMs: 10_000 } },
    },
    liveSessions: [{ id: 's1', token: 'tok-s1', user: ALICE }],
    cookie: [
      { id: 's1', token: 'tok-s1', loginName: 'alice@acme.test', organization: 'nudge-org' },
    ],
  };

  it('threads the CURRENT ceremony requestId onto the resolved /signed-in destination', () => {
    callService({
      fn: 'switchAccount',
      seed: nudge.seed,
      liveSessions: nudge.liveSessions,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: nudge.cookie,
        form: { intent: 'switch', sessionId: 's1', requestId: 'oidc_V3-current' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.match(/^\/signed-in(\?|$)/);
      expect(o.location).to.include(`requestId=${encodeURIComponent('oidc_V3-current')}`);
    });
  });

  it('omits requestId when none is provided (standalone switch fallback unchanged)', () => {
    callService({
      fn: 'switchAccount',
      seed: nudge.seed,
      liveSessions: nudge.liveSessions,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: nudge.cookie,
        form: { intent: 'switch', sessionId: 's1' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.match(/^\/signed-in(\?|$)/);
      expect(o.location).to.not.include('requestId=');
    });
  });

  it('ignores a non-allowlisted requestId (treated as no ceremony)', () => {
    callService({
      fn: 'switchAccount',
      seed: nudge.seed,
      liveSessions: nudge.liveSessions,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: nudge.cookie,
        form: { intent: 'switch', sessionId: 's1', requestId: 'evil_https://attacker.example' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.match(/^\/signed-in(\?|$)/);
      expect(o.location).to.not.include('requestId=');
    });
  });
});

describe('switchAccount — "Needs re-authentication" recovery (stale/revoked session)', () => {
  const cookie = [{ id: 's1', token: 'tok-1', loginName: 'alice@acme.test' }];
  const seed = { users: [ALICE] };

  it('redirects to /login (pre-filled loginName) when getSession returns null, not a 500', () => {
    callService({
      fn: 'switchAccount',
      seed,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'switch', sessionId: 's1' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.match(/^\/login(\?|$)/);
      expect(o.location).to.include('loginName=alice%40acme.test');
    });
  });

  it('redirects to /login when getSession throws a session-validity error (e.g. NOT_FOUND)', () => {
    callService({
      fn: 'switchAccount',
      seed,
      sessionResults: { s1: { mode: 'throw', code: 'NOT_FOUND' } },
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'switch', sessionId: 's1' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.match(/^\/login(\?|$)/);
    });
  });

  it('threads a live OIDC requestId onto the re-login redirect so the ceremony resumes', () => {
    callService({
      fn: 'switchAccount',
      seed,
      sessionResults: { s1: { mode: 'throw', code: 'PERMISSION_DENIED' } },
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'switch', sessionId: 's1', requestId: 'oidc_V3-current' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.match(/^\/login\?/);
      expect(o.location).to.include('requestId=oidc_V3-current');
    });
  });

  it('routes a device-grant re-auth to /login?requestId=device_<code> (resumes the grant)', () => {
    callService({
      fn: 'switchAccount',
      seed,
      sessionResults: { s1: { mode: 'null' } },
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'switch', sessionId: 's1', userCode: 'LQWC-KMNH' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.include('requestId=device_LQWC-KMNH');
    });
  });

  it('still surfaces PROVIDER_ERROR 500 for a genuinely transient backend failure', () => {
    callService({
      fn: 'switchAccount',
      seed,
      sessionResults: { s1: { mode: 'throw', code: 'UNAVAILABLE' } },
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'switch', sessionId: 's1' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('error');
      expect(o.error).to.equal('PROVIDER_ERROR');
      expect(o.status).to.equal(500);
    });
  });

  it('sets a reauth-intent cookie so the login/callback can verify the identity', () => {
    callService({
      fn: 'switchAccount',
      seed,
      sessionResults: { s1: { mode: 'throw', code: 'NOT_FOUND' } },
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'switch', sessionId: 's1' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.cookies?.some((c) => c.includes('reauth-intent=')) ?? false).to.equal(true);
    });
  });
});

describe('removeAccount — ceremony requestId threading', () => {
  const seed = { users: [ALICE] };
  const liveSessions = [{ id: 's1', token: 'tok-s1', user: ALICE }];
  const cookie = [{ id: 's1', token: 'tok-s1', loginName: 'alice@acme.test' }];

  it('carries an allowlisted requestId onto the /accounts redirect', () => {
    callService({
      fn: 'removeAccount',
      seed,
      liveSessions,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'remove', sessionId: 's1', requestId: 'oidc_V3-current' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal(`/accounts?requestId=${encodeURIComponent('oidc_V3-current')}`);
    });
  });

  it('redirects to bare /accounts when no requestId is provided', () => {
    callService({
      fn: 'removeAccount',
      seed,
      liveSessions,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'remove', sessionId: 's1' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('/accounts');
    });
  });

  it('drops a non-allowlisted requestId (no injection onto /accounts)', () => {
    callService({
      fn: 'removeAccount',
      seed,
      liveSessions,
      request: {
        url: 'http://localhost/id/accounts',
        sessions: cookie,
        form: { intent: 'remove', sessionId: 's1', requestId: 'evil_x' },
      },
    }).then((v) => {
      const o = v.outcome as Outcome;
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('/accounts');
    });
  });
});
