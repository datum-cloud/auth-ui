// cypress/component/routes/password/reset-loader-action.cy.ts
//
// CY-TASK: password/reset action when AUTH_EMAIL_DELIVERY_ENABLED=true.
// Migrated from: app/routes/password/__tests__/reset-loader-action.test.ts
//
// requestPasswordReset has enumeration safety: even when the loginName is unknown, the
// action returns the "sent" shape (not NOT_FOUND) to prevent email harvesting. The real
// function calls provider.findUser → if null, returns generic success. No provider seed
// needed for the success path. Loader param-threading is structural and not duplicated here.
import { callService } from '../../../support/node/call-service';

const BASE = 'http://localhost/id/password/reset';
const ENV_ON = { AUTH_EMAIL_DELIVERY_ENABLED: 'true' };

describe('password/reset action — delivery enabled', () => {
  it('returns 400 INVALID_INPUT when loginName is missing', () => {
    callService({
      fn: 'passwordResetAction',
      env: ENV_ON,
      request: { url: BASE, csrf: true, form: {} },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      expect((v.response!.dataBody as Record<string, unknown>).error).to.equal('INVALID_INPUT');
    });
  });

  it('returns the sent confirmation shape when loginName is provided (enumeration-safe)', () => {
    // requestPasswordReset returns {sent:true, email} even for unknown logins (enumeration safety).
    callService({
      fn: 'passwordResetAction',
      env: ENV_ON,
      request: { url: BASE, csrf: true, form: { loginName: 'user@example.com' } },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const body = v.response!.dataBody as Record<string, unknown>;
      expect(body.email).to.equal('user@example.com');
    });
  });
});
