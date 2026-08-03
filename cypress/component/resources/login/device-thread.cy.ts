// cypress/component/resources/login/device-thread.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/device-thread.test.ts.
//
// Device-grant ceremony threading: /device/authorize sends an unauthenticated user
// to /login?requestId=device_<userCode>. The identifier and password flows must
// accept and thread that requestId.
//
// Live bug found against real Zitadel 2026-06-13: both schemas allowed only /^oidc_/,
// so the device ceremony dead-ended with a 400 INVALID_INPUT at the very first
// identifier POST.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier, verifyLoginPassword } from '@/resources/login';

const REQUEST_ID = 'device_WDJB-MJHT';

// Fresh provider with alice@acme.test seeded — the Cypress select.server stub
// does NOT seed users, so we create a direct FakeAuthProvider instance here.
function makeProvider() {
  return new FakeAuthProvider({
    users: [{ id: 'u1', loginName: 'alice@acme.test' }],
    passwords: { u1: 'hunter2' },
    authMethods: { u1: ['password'] },
  });
}

// 755-M8: the two requestId prefixes take DIFFERENT post-password hops — device_ goes
// straight to /signed-in, oidc_ keeps the /authorize finalization carve-out. Same ceremony,
// same assertion shape, so one table with the expected destination per prefix.
const CEREMONIES: Array<{
  label: string;
  requestId: string;
  targetPattern: RegExp;
  mustNotContain?: string;
}> = [
  {
    label: 'device_ requestId reaches /signed-in',
    requestId: REQUEST_ID,
    targetPattern: /^\/signed-in/,
    mustNotContain: '/authorize',
  },
  {
    label: 'oidc_ requestId keeps the /authorize finalization carve-out',
    requestId: 'oidc_V2_abc123',
    targetPattern: /^\/authorize/,
  },
];

describe('device_ requestId threading through the login ceremony', () => {
  it('threads the requestId through identifier → password, sending device_ to /signed-in and oidc_ to /authorize (755-M8)', async () => {
    for (const { label, requestId, targetPattern, mustNotContain } of CEREMONIES) {
      const fake = makeProvider();

      // 1) identifier step establishes the ceremony session entry.
      const idResult = await resolveIdentifier(fake, [], {
        loginName: 'alice@acme.test',
        requestId,
        emailDeliveryEnabled: true,
      });
      expect(idResult.ok, `${label}: identifier step`).to.equal(true);
      if (!idResult.ok) return;
      expect(idResult.sessions.length, `${label}: ceremony session created`).to.be.greaterThan(0);

      // 2) password step must accept the threaded requestId.
      const pwResult = await verifyLoginPassword(fake, idResult.sessions, {
        loginName: 'alice@acme.test',
        password: 'hunter2',
        requestId,
      });
      expect(pwResult.ok, `${label}: password step`).to.equal(true);
      if (!pwResult.ok) return;

      // The requestId survives into the post-password redirect target.
      expect(pwResult.target, `${label}: requestId survives`).to.contain(`requestId=${requestId}`);
      expect(pwResult.target, `${label}: destination`).to.match(targetPattern);
      if (mustNotContain) {
        expect(pwResult.target, `${label}: no ${mustNotContain} hop`).not.to.contain(
          mustNotContain
        );
      }
    }
  });
});
