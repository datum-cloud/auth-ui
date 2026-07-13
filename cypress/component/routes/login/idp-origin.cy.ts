// cypress/component/routes/login/idp-origin.cy.ts
//
// cy.task port of app/routes/login/__tests__/idp-origin.test.ts.
// Route-level security regression: external-IdP return URLs must use PUBLIC_ORIGIN,
// not the request Host. Drives the real route action with a spoofed origin.
import { callService } from '../../../support/node/call-service';

const PUBLIC_ORIGIN = 'https://auth.localtest.me:30000';
const SPOOFED_ORIGIN = 'http://evil.example';
const GOOGLE_IDP_ID = 'idp-g';

describe('login action — IdP start: return URLs must use PUBLIC_ORIGIN, not request Host', () => {
  it('uses PUBLIC_ORIGIN for success URL when set (proxy/single-origin scenario)', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      env: { PUBLIC_ORIGIN },
      recordCalls: ['startIdpIntent'],
      request: {
        url: `${SPOOFED_ORIGIN}/id/login`,
        form: { intent: 'idp', idpId: GOOGLE_IDP_ID },
        csrf: true,
      },
    }).then((v) => {
      const idpCalls = v.calls?.startIdpIntent ?? [];
      expect(idpCalls).to.have.length(1);
      // args: [idpId, { success, failure }]
      const urls = idpCalls[0][1] as { success: string; failure: string };
      expect(urls.success).to.contain('/id/sso/');
      expect(urls.success.startsWith(`${PUBLIC_ORIGIN}/id/sso/`)).to.equal(true);
      expect(urls.success).not.to.contain('evil.example');
    });
  });
});
