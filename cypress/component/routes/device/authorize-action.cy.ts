// cypress/component/routes/device/authorize-action.cy.ts
//
// cy.task port of:
//   - app/routes/device/__tests__/authorize-action.test.ts (loader happy path + action)
//   - app/routes/device/__tests__/authorize.recovery.loader.test.ts (redirect + 404 paths)
//
// The loader reads a signed `sessions` cookie off a real Request (Cookie header blocked by the
// Fetch spec in the browser), so it is node-bound. The action also runs assertCsrf (HMAC
// round-trip). Both run through buildHandlerRequest in the harness.
//
// Singleton device auths used:
//   WDJB-MJHT → id: dev-1, appName: 'CLI', scope: ['openid']
//   DENY-CODE → id: dev-deny (used for the deny action path)
import { callService } from '../../../support/node/call-service';

// ── Loader — recovery paths ───────────────────────────────────────────────────

describe('device/authorize loader — recovery status', () => {
  it('bare GET (no user_code) → 302 redirect to /device', () => {
    callService({
      fn: 'deviceAuthorizeLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/authorize' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/device');
    });
  });

  it('stale/tampered user_code → 404 with recovery error', () => {
    callService({
      fn: 'deviceAuthorizeLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/authorize?user_code=NOPE' },
    }).then((v) => {
      // deviceConsentErrorToResponse returns data({ error }, { status: 404 })
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(404);
      const err = v.response?.dataBody as { error?: { recovery?: string } } | undefined;
      expect(err?.error?.recovery).to.equal('device');
    });
  });
});

// ── Loader — consent happy path ───────────────────────────────────────────────

describe('device/authorize loader — consent happy path', () => {
  it('valid user_code returns consent data including appName, scope, and csrfToken', () => {
    callService({
      fn: 'deviceAuthorizeLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/device/authorize?user_code=WDJB-MJHT' },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      // Singleton seeds: appName='CLI', scope=['openid'], deviceAuthId='dev-1'
      expect(body?.appName).to.equal('CLI');
      expect(body?.scope).to.be.an('array');
      expect(body?.deviceAuthId).to.equal('dev-1');
      expect(typeof body?.csrfToken).to.equal('string');
      expect((body?.csrfToken as string).length).to.be.greaterThan(0);
    });
  });
});

// ── Action paths ──────────────────────────────────────────────────────────────

describe('device/authorize action', () => {
  it('deny without session → 302 to /device/complete?decision=deny', () => {
    // Sessionless deny is deliberate (fail-safe: denial never grants).
    callService({
      fn: 'deviceAuthorizeAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/device/authorize',
        form: { deviceAuthId: 'dev-deny', requestId: 'device_DENY-CODE', decision: 'deny' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.include('/device/complete');
      expect(v.response?.location).to.include('decision=deny');
    });
  });

  it('authorize without session → redirects to /login (session gate)', () => {
    // The service gates authorize on a signed-in session. With no sessions cookie,
    // it redirects to /login?requestId=... instead of calling authorizeDevice.
    callService({
      fn: 'deviceAuthorizeAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/device/authorize',
        form: { deviceAuthId: 'dev-1', requestId: 'device_WDJB-MJHT', decision: 'authorize' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.include('/login');
      expect(v.response?.location).to.include('requestId=');
    });
  });
});
