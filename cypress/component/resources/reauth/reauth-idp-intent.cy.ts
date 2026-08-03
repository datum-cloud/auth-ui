// cypress/component/resources/reauth/reauth-idp-intent.cy.ts
//
// NO-MOUNT: startReauthIdpIntent starts a fresh OAuth round-trip pointed at the
// dedicated /reauth/:provider/callback + /reauth/:provider/error routes (NOT the
// existing /sso/:provider/callback, which is a separate sign-in/link/register/error
// decision tree for a different purpose).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { ProviderError } from '@/modules/auth/types';
import { startReauthIdpIntent } from '@/resources/reauth/reauth.service';

describe('startReauthIdpIntent', () => {
  it('builds success/failure URLs pointed at /reauth/:provider/callback|error with returnTo threaded', async () => {
    const fake = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'mia@acme.test' }] });
    let capturedUrls: { success: string; failure: string } | undefined;
    fake.startIdpIntent = async (_idpId, urls) => {
      capturedUrls = urls;
      return { authUrl: 'https://accounts.google.com/o/oauth2/auth?...' };
    };
    const result = await startReauthIdpIntent(fake, {
      idpId: 'idp-google',
      origin: 'http://localhost:3000',
      returnTo: '/passkeys',
    });
    expect(result).to.deep.equal({
      ok: true,
      authUrl: 'https://accounts.google.com/o/oauth2/auth?...',
    });
    expect(capturedUrls?.success).to.include('/id/reauth/idp-google/callback');
    expect(capturedUrls?.success).to.include('returnTo=%2Fpasskeys');
    expect(capturedUrls?.failure).to.include('/id/reauth/idp-google/error');
    expect(capturedUrls?.failure).to.include('returnTo=%2Fpasskeys');
  });

  // Both failure modes collapse to the SAME deep.equal, differing only in how the provider
  // fails: it throws, or it returns a response with no authUrl.
  const FAILURES: [label: string, startIdpIntent: () => Promise<unknown>][] = [
    [
      'provider throws a ProviderError',
      async () => {
        throw new ProviderError('UNAVAILABLE', 'idp down');
      },
    ],
    ['provider returns no authUrl', async () => ({})],
  ];

  it('maps every startIdpIntent failure mode (a thrown ProviderError, a missing authUrl) to IDP_UNAVAILABLE', async () => {
    for (const [label, startIdpIntent] of FAILURES) {
      const fake = new FakeAuthProvider({ users: [{ id: 'u1', loginName: 'mia@acme.test' }] });
      fake.startIdpIntent = startIdpIntent as typeof fake.startIdpIntent;
      const result = await startReauthIdpIntent(fake, {
        idpId: 'idp-google',
        origin: 'http://localhost:3000',
        returnTo: '/passkeys',
      });
      expect(result, label).to.deep.equal({ ok: false, error: 'IDP_UNAVAILABLE' });
    }
  });
});
