// cypress/component/routes/password/password-loader-action.cy.ts
//
// CY-TASK: password/new action — node-bound.
// Migrated from: app/routes/password/__tests__/password-loader-action.test.ts
//
// For passwordNewAction success: uses the preSendPasswordReset compound seam in harness.ts.
// The harness calls provider.sendPasswordReset(userId, urlTemplate) which sets
// resetCodes[userId]='reset-{userId}'. The action then passes because
// setPasswordWithCode(userId, 'reset-{userId}', password) finds the matching code.
//
// CUT: "changePassword success (302)" — requires a live session seeded in the provider;
// demoted to E2E coverage. Loader param-threading, password/change action, and
// complexity-policy fan-out are covered once each elsewhere in this suite — not
// duplicated here; this file keeps the one happy-path + one representative failure
// for the password/new action.
import { callService } from '../../../support/node/call-service';

const NEW_BASE = 'http://localhost/id/password/new';

// ─── password/new — action ────────────────────────────────────────────────────

describe('password/new action', () => {
  it('returns 400 with INVALID_INPUT when form data fails schema validation', () => {
    // Missing required code/userId — schema fails before provider interaction.
    callService({
      fn: 'passwordNewAction',
      request: { url: NEW_BASE, csrf: true, form: { password: 'pw', confirm: 'pw' } },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.dataStatus ?? 200;
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('INVALID_INPUT');
    });
  });

  it('redirects (302) when reset code matches (compound preSendPasswordReset seam)', () => {
    // preSendPasswordReset='u-reset' causes harness to call provider.sendPasswordReset('u-reset',…)
    // which sets resetCodes['u-reset']='reset-u-reset'. Action then succeeds with that code.
    callService({
      fn: 'passwordNewAction',
      provider: 'singleton',
      request: {
        url: NEW_BASE,
        csrf: true,
        form: {
          preSendPasswordReset: 'u-reset',
          userId: 'u-reset',
          code: 'reset-u-reset',
          password: 'SecurePass123!',
          confirm: 'SecurePass123!',
        },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
    });
  });
});
