// cypress/component/resources/login/idp-origin.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/idp-origin.test.ts.
// Uses cy.spy (call-through) to capture startIdpIntent args without replacing.
//
// Regression: external-IdP return URLs must use PUBLIC_ORIGIN, not the request Host.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { startIdpIntent } from '@/resources/login';

const PUBLIC_ORIGIN = 'https://auth.localtest.me:30000';
// This IdP id must exist in the provider — use a fresh FakeAuthProvider seeded with it.
const GOOGLE_IDP_ID = 'idp-g';

function makeProvider() {
  return new FakeAuthProvider({
    idps: [{ id: GOOGLE_IDP_ID, name: 'Google', type: 'GOOGLE' }],
  });
}

describe('login IdP start: return URLs must use PUBLIC_ORIGIN, not request Host', () => {
  it('uses PUBLIC_ORIGIN for the success URL (proxy/single-origin scenario)', async () => {
    const fake = makeProvider();
    const spy = cy.spy(fake, 'startIdpIntent');

    const result = await startIdpIntent(fake, { idpId: GOOGLE_IDP_ID, origin: PUBLIC_ORIGIN });

    expect(result.ok).to.equal(true);
    expect(spy.callCount).to.equal(1);
    const [_idpId, urls] = spy.args[0];
    const successUrl: string = (urls as { success: string; failure: string }).success;

    expect(successUrl).to.contain('/id/sso/');
    expect(successUrl.startsWith(`${PUBLIC_ORIGIN}/id/sso/`)).to.equal(true);
    expect(successUrl).not.to.contain('evil.example');
  });
});

describe('login IdP start: re-auth login_hint (best-effort IdP pre-selection)', () => {
  it('appends login_hint to the authorize URL when re-authenticating a specific account', async () => {
    const fake = makeProvider();
    const result = await startIdpIntent(fake, {
      idpId: GOOGLE_IDP_ID,
      origin: PUBLIC_ORIGIN,
      reauthHint: 'alice@acme.test',
    });
    expect(result.ok).to.equal(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.authUrl).to.contain('login_hint=alice%40acme.test');
  });

  it('omits login_hint for a normal (non-re-auth) IdP start', async () => {
    const fake = makeProvider();
    const result = await startIdpIntent(fake, { idpId: GOOGLE_IDP_ID, origin: PUBLIC_ORIGIN });
    expect(result.ok).to.equal(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.authUrl).not.to.contain('login_hint');
  });
});
