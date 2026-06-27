// cypress/component/resources/session/session.service.signed-in.cy.ts
//
// cy.task node-spec port of app/resources/session/__tests__/session.service.signed-in.test.ts.
// resolveSignedIn reads the signed `sessions` cookie to find the active session, so it is
// node-bound. SECURITY: the device-grant auto-complete path (755-M8) must authorize the grant
// against the active session and land on the terminal page (no second consent screen).
import { callService, type AuditEvent } from '../../../support/node/call-service';

const CONSOLE_URL = 'https://auth.localtest.me:30000/ui/console';
const cfg = (defaultAppUrl?: string) => ({ consoleUrl: CONSOLE_URL, defaultAppUrl });
const COOKIE = (
  over: Partial<{ id: string; token: string; loginName: string; organization: string }> = {}
) => [
  {
    id: over.id ?? 's1',
    token: over.token ?? 't1',
    loginName: over.loginName ?? 'alice@acme.test',
    organization: over.organization,
  },
];

function hasAudit(audit: AuditEvent[], event: string, outcome: string) {
  return audit.some((e) => e.event === event && e.outcome === outcome);
}

describe('resolveSignedIn — protocol forward (regression)', () => {
  it('forwards an oidc_ requestId to /authorize to complete the callback', () => {
    callService({
      fn: 'resolveSignedIn',
      provider: 'singleton',
      signedInConfig: cfg(),
      request: { url: 'http://localhost/id/signed-in?requestId=oidc_V2_1' },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.include('/authorize?requestId=oidc_V2_1');
    });
  });

  it('hands back the active sessionId on oidc_ so /authorize completes (no select_account loop)', () => {
    callService({
      fn: 'resolveSignedIn',
      provider: 'singleton',
      signedInConfig: cfg(),
      request: {
        url: 'http://localhost/id/signed-in?requestId=oidc_V2_1',
        sessions: COOKIE({ id: 's1' }),
      },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.include('requestId=oidc_V2_1');
      expect(o.location).to.include('sessionId=s1');
    });
  });

  it('forwards a saml_ requestId to /authorize', () => {
    callService({
      fn: 'resolveSignedIn',
      provider: 'singleton',
      signedInConfig: cfg(),
      request: { url: 'http://localhost/id/signed-in?requestId=saml_sr-1' },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.include('/authorize?requestId=saml_sr-1');
    });
  });
});

describe('resolveSignedIn — device-grant auto-complete (755-M8)', () => {
  const seed = {
    deviceAuths: [{ userCode: 'WDJB-MJHT', id: 'dev-1', appName: 'CLI', scope: ['openid'] }],
  };

  it('auto-authorizes the device grant and lands on the terminal page (no second consent)', () => {
    callService({
      fn: 'resolveSignedIn',
      provider: 'fresh',
      seed,
      liveSessions: [{ id: 's1', token: 't1' }],
      signedInConfig: cfg(),
      inspect: { isDeviceAuthorized: ['dev-1'] },
      request: {
        url: 'http://localhost/id/signed-in?requestId=device_WDJB-MJHT',
        sessions: COOKIE({ id: 's1', token: 't1' }),
      },
    }).then((v) => {
      const o = v.outcome as { kind: string; deviceComplete?: boolean; loginName?: string };
      expect(o.kind).to.equal('page');
      expect(o.deviceComplete).to.equal(true);
      expect(o.loginName).to.equal('alice@acme.test');
      expect((v.inspect?.isDeviceAuthorized as Record<string, boolean>)['dev-1']).to.equal(true);
      expect(hasAudit(v.audit, 'device_authorize', 'success')).to.equal(true);
    });
  });

  it('redirects to /login (not auto-complete) when no active session is present', () => {
    callService({
      fn: 'resolveSignedIn',
      provider: 'fresh',
      seed,
      liveSessions: [{ id: 's1', token: 't1' }],
      signedInConfig: cfg(),
      inspect: { isDeviceAuthorized: ['dev-1'] },
      request: { url: 'http://localhost/id/signed-in?requestId=device_WDJB-MJHT' },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('/login');
      expect((v.inspect?.isDeviceAuthorized as Record<string, boolean>)['dev-1']).to.equal(false);
    });
  });

  it('resolves to a device-error outcome when the grant cannot be authorized (stale code)', () => {
    callService({
      fn: 'resolveSignedIn',
      provider: 'fresh',
      seed,
      liveSessions: [{ id: 's1', token: 't1' }],
      signedInConfig: cfg(),
      request: {
        url: 'http://localhost/id/signed-in?requestId=device_UNKNOWN',
        sessions: COOKIE({ id: 's1', token: 't1' }),
      },
    }).then((v) => {
      const o = v.outcome as { kind: string };
      expect(o.kind).to.equal('device-error');
      expect(hasAudit(v.audit, 'device_authorize', 'failure')).to.equal(true);
    });
  });
});

describe('resolveSignedIn — no-session redirect', () => {
  it('redirects to /login when no active session is in the cookie', () => {
    callService({
      fn: 'resolveSignedIn',
      provider: 'singleton',
      signedInConfig: cfg(),
      request: { url: 'http://localhost/id/signed-in' },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('/login');
    });
  });
});

describe('resolveSignedIn — post-login destination routing', () => {
  const base = {
    fn: 'resolveSignedIn' as const,
    provider: 'fresh' as const,
    liveSessions: [{ id: 's1', token: 't1' }],
    instanceAdminSession: null,
  };

  it('falls back to env DEFAULT_APP_URL when getLoginSettings rejects (no throw, no admin)', () => {
    callService({
      ...base,
      failLoginSettings: true,
      signedInConfig: cfg('https://app.example'),
      request: { url: 'http://localhost/id/signed-in', sessions: COOKIE({ organization: 'org1' }) },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('https://app.example');
    });
  });

  it('instance admin → redirect to ZITADEL_API_URL/ui/console', () => {
    callService({
      ...base,
      instanceAdminSession: 's1',
      signedInConfig: cfg(),
      request: { url: 'http://localhost/id/signed-in', sessions: COOKIE() },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal(CONSOLE_URL);
    });
  });

  it('non-admin + getLoginSettings returns defaultRedirectUri → redirect to that URI', () => {
    callService({
      ...base,
      loginDefaultRedirectUri: 'https://portal.example',
      signedInConfig: cfg(),
      request: { url: 'http://localhost/id/signed-in', sessions: COOKIE() },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('https://portal.example');
    });
  });

  it('non-admin + no defaultRedirectUri + DEFAULT_APP_URL set → redirect to DEFAULT_APP_URL', () => {
    callService({
      ...base,
      signedInConfig: cfg('http://localhost:3001'),
      request: { url: 'http://localhost/id/signed-in', sessions: COOKIE() },
    }).then((v) => {
      const o = v.outcome as { kind: string; location?: string };
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('http://localhost:3001');
    });
  });

  it('non-admin + no defaultRedirectUri + DEFAULT_APP_URL unset → "You are signed in" page (no redirect)', () => {
    callService({
      ...base,
      signedInConfig: cfg(),
      request: {
        url: 'http://localhost/id/signed-in',
        sessions: COOKIE({ loginName: 'alice@acme.test' }),
      },
    }).then((v) => {
      const o = v.outcome as { kind: string; loginName?: string };
      expect(o.kind).to.not.equal('redirect');
      expect(o.kind).to.equal('page');
      expect(o.loginName).to.equal('alice@acme.test');
    });
  });
});

describe('resolveSignedIn — audit event emission', () => {
  it('emits a post_login_settings failure event when getLoginSettings rejects', () => {
    callService({
      fn: 'resolveSignedIn',
      provider: 'fresh',
      liveSessions: [{ id: 's1', token: 't1' }],
      instanceAdminSession: null,
      failLoginSettings: true,
      signedInConfig: cfg('https://app.example'),
      request: { url: 'http://localhost/id/signed-in', sessions: COOKIE({ organization: 'org1' }) },
    }).then((v) => {
      expect(hasAudit(v.audit, 'post_login_settings', 'failure')).to.equal(true);
    });
  });
});
