// cypress/component/routes/verify/verify-loader-action.cy.ts
//
// CY-TASK: verify/index action — node-bound.
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
// Loader param-threading, the INVALID_INPUT gate, and the resend-intent branch are
// covered structurally elsewhere; this file keeps the one happy-path + one
// representative failure for the core verify intent.
import { callService } from '../../../support/node/call-service';

const BASE = 'http://localhost/id/verify';

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
});
