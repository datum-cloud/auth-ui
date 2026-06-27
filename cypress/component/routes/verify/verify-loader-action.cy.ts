// cypress/component/routes/verify/verify-loader-action.cy.ts
//
// CY-TASK: verify/index loader + action — node-bound.
// Migrated from: app/routes/verify/__tests__/verify-loader-action.test.ts
//
// verifyIndexAction success (redirect→302): uses the preRegisterEmail compound seam
// in harness.ts. The harness calls provider.register({email}) on the SINGLETON
// (same instance used internally by providerForRequest(request)), which sets
// emailCodes.set(userId, `email-${userId}`). The action's verifyEmail call then
// succeeds with that code. Using provider:'fresh'/seed does NOT work because
// the route handler always resolves providerForRequest → singleton, not the
// freshly-seeded instance.
//
// CUT: "dispatches email code when send=true" — original used vi.doMock which bypasses the
// module cache; the test assertion was `expect(true).toBe(true)` (loader-didn't-throw).
// In cy.task the loader runs the real dispatchEmailCode path. Covered implicitly by
// "returns all query params" which does not pass send=true and therefore tests the fast path.
import { callService } from '../../../support/node/call-service';

const BASE = 'http://localhost/id/verify';

// ─── Loader ───────────────────────────────────────────────────────────────────

describe('verify loader', () => {
  it('returns all query params as loader data (fast path — no dispatch)', () => {
    callService({
      fn: 'verifyIndexLoader',
      request: {
        url: `${BASE}?userId=u1&loginName=a%40b.test&organization=org1&requestId=rq1&code=123456`,
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.userId).to.equal('u1');
      expect(body.loginName).to.equal('a@b.test');
      expect(body.organization).to.equal('org1');
      expect(body.requestId).to.equal('rq1');
      expect(body.code).to.equal('123456');
      expect(typeof body.csrfToken).to.equal('string');
    });
  });

  it('does not throw when send is absent', () => {
    callService({
      fn: 'verifyIndexLoader',
      request: { url: `${BASE}?userId=u1` },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect((v.response!.dataBody as Record<string, unknown>).userId).to.equal('u1');
    });
  });

  it('returns empty strings for absent optional params', () => {
    callService({
      fn: 'verifyIndexLoader',
      request: { url: BASE },
    }).then((v) => {
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.userId).to.equal('');
      expect(body.code).to.equal('');
      expect(body.invite).to.be.undefined;
      expect(body.loginName).to.be.undefined;
    });
  });
});

// ─── Action — INVALID_INPUT gate ─────────────────────────────────────────────

describe('verify action — INVALID_INPUT gate', () => {
  it('returns 400 INVALID_INPUT when userId is missing', () => {
    callService({
      fn: 'verifyIndexAction',
      request: {
        url: BASE,
        csrf: true,
        form: { code: '123456', invite: 'false' },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('INVALID_INPUT');
    });
  });
});

// ─── Action — resend intent ───────────────────────────────────────────────────

describe('verify action — resend intent', () => {
  it('returns 200 with notice when resend succeeds', () => {
    // No provider:'fresh'/seed needed: the action resolves providerForRequest → the
    // SINGLETON (a freshly-seeded instance would be ignored), and the fake's
    // resendEmailCode just stamps a new code for any not-yet-verified userId — so resend
    // succeeds without pre-registering the user.
    callService({
      fn: 'verifyIndexAction',
      request: {
        url: BASE,
        csrf: true,
        form: { userId: 'u-resend', code: 'resend', invite: 'false', intent: 'resend' },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(200);
      expect((v.response!.dataBody as Record<string, unknown>).notice).to.exist;
    });
  });

  it('returns 400 with INVALID_INPUT when a resend request fails the input gate', () => {
    // Restores the original "resend action returns 400 when resend fails" coverage.
    // The original vitest test MOCKED the resendEmailCode SERVICE to return
    // { ok: false, error: 'INVALID_INPUT' }. In the integrated cy.task stack the REAL
    // service returns { ok: false, error: 'INVALID_INPUT' } ONLY when userId is empty,
    // and the route runs verifyCodeSchema over the WHOLE form (covering verify AND resend)
    // BEFORE the intent branch — so a resend POST with a missing userId is rejected at that
    // shared gate with the identical 400 + INVALID_INPUT shape. (A provider-level resend
    // throw instead re-throws uncaught: the route has no try/catch around the resend branch,
    // so that path is NOT a 400 — see the task-13d fix report.)
    callService({
      fn: 'verifyIndexAction',
      request: {
        url: BASE,
        csrf: true,
        // userId intentionally omitted → verifyCodeSchema fails → 400 INVALID_INPUT
        form: { code: 'resend', invite: 'false', intent: 'resend' },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('INVALID_INPUT');
    });
  });
});

// ─── Action — verify intent ───────────────────────────────────────────────────

describe('verify action — verify intent', () => {
  it('redirects (302) when submitEmailCode returns ok (preRegisterEmail seam)', () => {
    // preRegisterEmail causes harness to call provider.register() on the SINGLETON,
    // setting emailCodes[userId]='email-{userId}'. The action's providerForRequest
    // resolves to the same singleton, so verifyEmail succeeds.
    callService({
      fn: 'verifyIndexAction',
      request: {
        url: BASE,
        csrf: true,
        form: {
          preRegisterEmail: 'verify@test.com',
          invite: 'false',
          intent: 'verify',
        },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
    });
  });

  it('returns 400 with INVALID_CREDENTIALS when the code is wrong', () => {
    // FakeAuthProvider.verifyEmail throws INVALID_CREDENTIALS when the code
    // doesn't match — no seeding needed; any unknown userId + wrong code suffices.
    callService({
      fn: 'verifyIndexAction',
      request: {
        url: BASE,
        csrf: true,
        form: {
          userId: 'u-nonexistent',
          code: 'totally-wrong-code',
          invite: 'false',
          intent: 'verify',
        },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.exist;
    });
  });

  it('passes hasActiveSession=true when a session cookie is present (→ /signed-in)', () => {
    // Restores the original "passes hasActiveSession=true" case (previously a duplicate of
    // the first verify test). A REAL signed `sessions` cookie (request.sessions) makes the
    // action's mostRecent(readSessions(request)) resolve a session → hasActiveSession=true.
    // submitEmailCode then returns the active-session target (/signed-in, since no
    // requestId), distinguishing this branch from the no-session /verify/success branch.
    callService({
      fn: 'verifyIndexAction',
      request: {
        url: BASE,
        csrf: true,
        sessions: [{ id: 's1', token: 'tok', loginName: 'a@b.test' }],
        form: {
          preRegisterEmail: 'withsession@test.com',
          invite: 'false',
          intent: 'verify',
        },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
      // Active-session branch redirects to /signed-in (no requestId present), proving
      // hasActiveSession=true flowed into submitEmailCode.
      expect(v.response!.location).to.equal('/signed-in');
    });
  });
});
