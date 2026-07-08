// cypress/component/routes/password/reset-delivery-guard.cy.ts
//
// CY-TASK: password/reset loader and action when AUTH_EMAIL_DELIVERY_ENABLED=false.
// Migrated from: app/routes/password/__tests__/reset-delivery-guard.test.ts
//
// Each cy.task call spawns a fresh Bun process, so the env field injects
// AUTH_EMAIL_DELIVERY_ENABLED=false before the module is loaded. This is the same
// mechanism as the Vitest vi.mock of env.server.
import { callService } from '../../../support/node/call-service';

const BASE = 'http://localhost/id/password/reset';
const ENV_OFF = { AUTH_EMAIL_DELIVERY_ENABLED: 'false' };

describe('password/reset loader — guard when delivery is off', () => {
  it('redirects to /login when AUTH_EMAIL_DELIVERY_ENABLED=false', () => {
    callService({
      fn: 'passwordResetLoader',
      env: ENV_OFF,
      request: { url: BASE },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
      expect(v.response!.location).to.equal('/login');
    });
  });

  it('threads requestId/organization onto the /login redirect (regression: previously a bare /login mid-ceremony)', () => {
    callService({
      fn: 'passwordResetLoader',
      env: ENV_OFF,
      request: { url: `${BASE}?requestId=oidc_V2_123&organization=org-1` },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      expect(v.response!.isResponse).to.be.true;
      expect(v.response!.status).to.equal(302);
      expect(v.response!.location).to.equal('/login?requestId=oidc_V2_123&organization=org-1');
    });
  });
});

describe('password/reset action — guard when delivery is off', () => {
  it('returns 400 INVALID_INPUT for a crafted POST when delivery is off', () => {
    callService({
      fn: 'passwordResetAction',
      env: ENV_OFF,
      request: {
        url: BASE,
        csrf: true,
        form: { loginName: 'victim@example.com' },
      },
    }).then((v) => {
      expect(v.error).to.be.undefined;
      const status = v.response!.isResponse ? v.response!.status : (v.response!.dataStatus ?? 200);
      expect(status).to.equal(400);
      const body = v.response!.dataBody as Record<string, unknown> | undefined;
      expect(body?.error).to.equal('INVALID_INPUT');
    });
  });
});
