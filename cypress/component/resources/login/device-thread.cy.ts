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

describe('device_ requestId threading through the login ceremony', () => {
  it('password flow accepts a device_ requestId and threads it (not rejected)', async () => {
    const fake = makeProvider();

    // 1) identifier step establishes the ceremony session entry.
    const idResult = await resolveIdentifier(fake, [], {
      loginName: 'alice@acme.test',
      requestId: REQUEST_ID,
      emailDeliveryEnabled: true,
    });
    expect(idResult.ok).to.equal(true);
    if (!idResult.ok) return;
    expect(idResult.sessions.length).to.be.greaterThan(0);

    // 2) password step must accept the threaded device_ requestId.
    const pwResult = await verifyLoginPassword(fake, idResult.sessions, {
      loginName: 'alice@acme.test',
      password: 'hunter2',
      requestId: REQUEST_ID,
    });
    expect(pwResult.ok).to.equal(true);
    if (!pwResult.ok) return;
    // The device_ requestId survives into the post-password redirect target.
    expect(pwResult.target).to.contain(`requestId=${REQUEST_ID}`);
    // 755-M8: a device_ requestId must reach /signed-in (NOT /authorize finalization).
    expect(pwResult.target).to.match(/^\/signed-in/);
    expect(pwResult.target).not.to.contain('/authorize');
  });

  it('755-M8: an oidc_ requestId STILL takes the /authorize finalization carve-out', async () => {
    const fake = makeProvider();
    const oidcReq = 'oidc_V2_abc123';
    const idResult = await resolveIdentifier(fake, [], {
      loginName: 'alice@acme.test',
      requestId: oidcReq,
      emailDeliveryEnabled: true,
    });
    expect(idResult.ok).to.equal(true);
    if (!idResult.ok) return;
    const pwResult = await verifyLoginPassword(fake, idResult.sessions, {
      loginName: 'alice@acme.test',
      password: 'hunter2',
      requestId: oidcReq,
    });
    expect(pwResult.ok).to.equal(true);
    if (!pwResult.ok) return;
    // Non-device requestIds keep the OIDC finalization hop to /authorize.
    expect(pwResult.target).to.match(/^\/authorize/);
    expect(pwResult.target).to.contain(`requestId=${oidcReq}`);
  });
});
