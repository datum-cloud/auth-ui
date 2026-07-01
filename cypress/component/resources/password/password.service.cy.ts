// cypress/component/resources/password/password.service.cy.ts
//
// Component (no-mount) port of app/resources/password/__tests__/password.service.test.ts.
//
// SECURITY REGRESSION: the password-reset email link MUST be built from the
// trusted PUBLIC_ORIGIN, never the client-controllable request Host header.
//
// Uses cy.stub (replacing) instead of vi.spyOn(...).mockResolvedValue(), and a
// fresh FakeAuthProvider seeded with alice rather than the Cypress select.server
// stub (which lacks users).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { requestPasswordReset } from '@/resources/password/password.service';

const TRUSTED_ORIGIN = 'https://auth.datum.net';
const SPOOFED_HOST = 'attacker.evil';

// Fresh provider with alice seeded — the Cypress select.server stub lacks users,
// so we instantiate directly. alice (u1 / hunter2) is the seed the service looks up.
function makeProvider() {
  return new FakeAuthProvider({
    users: [{ id: 'u1', loginName: 'alice@acme.test' }],
    passwords: { u1: 'hunter2' },
    authMethods: { u1: ['password'] },
  });
}

describe('requestPasswordReset — email-link origin (anti Host-header injection)', () => {
  it('builds the reset link from the trusted origin, NOT a spoofed Host', async () => {
    const fake = makeProvider();
    // cy.stub replaces the method and lets us inspect call args + control return value.
    const stub = cy.stub(fake, 'sendPasswordReset').resolves();

    await requestPasswordReset(fake, {
      loginName: 'alice@acme.test',
      origin: TRUSTED_ORIGIN,
    });

    expect(stub.callCount).to.equal(1);
    const [userId, urlTemplate] = stub.args[0];
    expect(userId).to.equal('u1');
    // Origin-trusted: uses PUBLIC_ORIGIN, never the spoofed Host.
    expect(urlTemplate.startsWith('https://auth.datum.net/id/password/new?')).to.equal(true);
    expect(urlTemplate).not.to.contain(SPOOFED_HOST);
    // Raw braces preserved (NOT percent-encoded) — Zitadel does not decode %7B%7B.
    expect(urlTemplate).to.contain('code={{.Code}}');
    expect(urlTemplate).not.to.contain('%7B');
  });

  it('does NOT call sendPasswordReset for an unknown account (enumeration-safe)', async () => {
    const fake = makeProvider();
    const stub = cy.stub(fake, 'sendPasswordReset').resolves();

    await requestPasswordReset(fake, {
      loginName: 'nobody@example.test',
      origin: TRUSTED_ORIGIN,
    });

    expect(stub.callCount).to.equal(0);
  });
});
