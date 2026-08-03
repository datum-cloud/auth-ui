// cypress/component/resources/session/session.service.signed-in.cy.ts
//
// cy.task node-spec port of app/resources/session/__tests__/session.service.signed-in.test.ts.
// resolveSignedIn reads the signed `sessions` cookie to find the active session, so it is
// node-bound. SECURITY (#10): a device grant is a state-changing RFC 8628 consent grant and must
// NOT be auto-completed from this GET loader (forgeable ?requestId=, no consent proof). resolveSignedIn
// hands a device_ requestId back to the CSRF-protected /device/authorize consent screen; it must
// authorize NOTHING itself.
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

describe('resolveSignedIn — device-grant hand-back to consent (#10)', () => {
  const seed = {
    deviceAuths: [{ userCode: 'WDJB-MJHT', id: 'dev-1', appName: 'CLI', scope: ['openid'] }],
  };

  it('does NOT auto-authorize — it redirects to the /device/authorize consent screen', () => {
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
      const o = v.outcome as { kind: string; location?: string };
      // Hand back to the explicit CSRF-protected consent screen — NEVER auto-complete here.
      expect(o.kind).to.equal('redirect');
      expect(o.location).to.equal('/device/authorize?user_code=WDJB-MJHT');
      // The grant must NOT have been authorized by the GET loader.
      expect((v.inspect?.isDeviceAuthorized as Record<string, boolean>)['dev-1']).to.equal(false);
      expect(hasAudit(v.audit, 'device_authorize', 'success')).to.equal(false);
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

describe('resolveSignedIn — terminal page carries the analytics-identify userId', () => {
  // Same call, same assertion shape — only the cookie token and the expected userId vary. A
  // mismatched token must degrade userId to null WITHOUT blocking the page.
  const CASES: [label: string, token: string, expectedUserId: string | null][] = [
    ['resolving token', 't1', 'user-42'],
    ['stale/mismatched token', 'wrong-token', null],
  ];

  it("resolves the provider session's user id onto the terminal page, degrading to null (never blocking) when the cookie session does not resolve", () => {
    for (const [label, token, expectedUserId] of CASES) {
      callService({
        fn: 'resolveSignedIn',
        provider: 'fresh',
        seed: {},
        liveSessions: [
          { id: 's1', token: 't1', user: { id: 'user-42', loginName: 'alice@acme.test' } },
        ],
        signedInConfig: cfg(),
        request: {
          url: 'http://localhost/id/signed-in',
          sessions: COOKIE({ id: 's1', token }),
        },
      }).then((v) => {
        const o = v.outcome as { kind: string; loginName?: string | null; userId?: string | null };
        expect(o.kind, `${label}: page still renders`).to.equal('page');
        expect(o.userId, `${label}: userId`).to.equal(expectedUserId);
        if (expectedUserId) {
          expect(o.loginName, `${label}: loginName`).to.equal('alice@acme.test');
        }
      });
    }
  });
});
