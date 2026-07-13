// cypress/component/modules/auth/providers/zitadel/settings-idp.behavior.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/settings-idp.behavior.test.ts.
// Exercises the settings.ts and idp.ts capability modules via the ZitadelAuthProvider public surface
// using the same __setCreateServiceClientImpl hook as index.cy.ts.
//
// Final squeeze: these are boundary-conformance mappers, not user-facing security logic. Reduced
// to one test per capability-module function group; startIdpIntent's oneof-shape mapping is
// merged with the other idp RPC forwarding cases since both share the same
// map/forward-through-RPC mechanism. startLdapIntent is kept standalone since it is the one
// error-throwing branch (ProviderError on missing intent).
import { ZitadelAuthProvider } from '@/modules/auth/providers/zitadel/index';
import * as transport from '@/modules/auth/providers/zitadel/transport';
import { ProviderError } from '@/modules/auth/types';

const provider = () => new ZitadelAuthProvider({ serviceUrl: 'https://z.test', serviceToken: 't' });

const stubClient = (impl: Record<string, unknown>) =>
  (
    transport as unknown as { __setCreateServiceClientImpl: (fn: unknown) => void }
  ).__setCreateServiceClientImpl(() => impl);

afterEach(() => {
  (
    transport as unknown as { __resetCreateServiceClientImpl: () => void }
  ).__resetCreateServiceClientImpl();
});

// ── settings capability module ─────────────────────────────────────────────────

describe('zitadel/settings — capability module', () => {
  it('getLoginSettings/getBranding/getPasswordComplexity/getActiveIdPs map proto responses through their mappers, tolerating absent settings', async () => {
    stubClient({
      getLoginSettings: async () => ({
        settings: {
          allowUsernamePassword: true,
          allowRegister: true,
          allowExternalIdp: false,
          passkeysType: 1,
          hidePasswordReset: true,
        },
      }),
    });
    const s = await provider().getLoginSettings('org-1');
    expect(s.allowPassword).to.equal(true);
    expect(s.passkeysType).to.equal('allowed');

    stubClient({ getLoginSettings: async () => ({}) });
    const empty = await provider().getLoginSettings();
    expect(empty.allowPassword).to.equal(false);

    stubClient({ getBrandingSettings: async () => ({ settings: { themeMode: 1 } }) });
    const b = await provider().getBranding('org-2');
    expect(b).to.be.ok;

    stubClient({
      getPasswordComplexitySettings: async () => ({
        settings: { minLength: 8n, requiresUppercase: true },
      }),
    });
    const c = (await provider().getPasswordComplexity()) as { minLength: number };
    expect(c.minLength).to.equal(8);

    stubClient({ getPasswordComplexitySettings: async () => ({}) });
    expect(await provider().getPasswordComplexity()).to.be.undefined;

    stubClient({
      getActiveIdentityProviders: async () => ({
        identityProviders: [{ id: 'idp-1', name: 'Google', type: 6 }],
      }),
    });
    const idps = await provider().getActiveIdPs('org-4');
    expect(idps).to.have.length(1);
    expect(idps[0].id).to.equal('idp-1');

    stubClient({ getActiveIdentityProviders: async () => ({}) });
    expect(await provider().getActiveIdPs()).to.deep.equal([]);
  });
});

// ── idp capability module ──────────────────────────────────────────────────────

describe('zitadel/idp — capability module', () => {
  it('startIdpIntent, retrieveIdpIntent, listIdpLinks, addIdpLink, and removeIdpLink each map/forward through their RPC', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: { case: 'authUrl', value: 'https://idp/redirect' },
      }),
    });
    const authUrlResult = await provider().startIdpIntent('idp-1', { success: 's', failure: 'f' });
    expect(authUrlResult.authUrl).to.equal('https://idp/redirect');

    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: { case: 'formData', value: { post: 'x' } },
      }),
    });
    const formDataResult = await provider().startIdpIntent('idp-1', { success: 's', failure: 'f' });
    expect(formDataResult.formData).to.deep.equal({ post: 'x' });

    stubClient({
      retrieveIdentityProviderIntent: async () => ({
        idpInformation: { idpId: 'idp-1', userId: 'ext-1', userName: 'jane' },
        userId: 'z-1',
      }),
    });
    const r = await provider().retrieveIdpIntent('intent-1', 'tok');
    expect(r.information.idpId).to.equal('idp-1');

    stubClient({
      listIDPLinks: async () => ({
        result: [{ idpId: 'idp-1', userId: 'ext-1', userName: 'jane' }],
      }),
    });
    const links = await provider().listIdpLinks('z-1');
    expect(links).to.have.length(1);
    expect(links[0].idpId).to.equal('idp-1');

    stubClient({ listIDPLinks: async () => ({}) });
    expect(await provider().listIdpLinks('z-1')).to.deep.equal([]);

    const addImpl = { addIDPLink: async () => ({}) };
    const addSpy = cy.stub(addImpl, 'addIDPLink').resolves({});
    stubClient(addImpl);
    await provider().addIdpLink('z-1', { idpId: 'idp-1', idpUserId: 'ext-1', idpUserName: 'jane' });
    expect(addSpy).to.have.callCount(1);

    const removeImpl = { removeIDPLink: async () => ({}) };
    const removeSpy = cy.stub(removeImpl, 'removeIDPLink').resolves({});
    stubClient(removeImpl);
    await provider().removeIdpLink('z-1', 'idp-1', 'ext-1');
    expect(removeSpy).to.have.callCount(1);
  });

  it('startLdapIntent returns the intent tuple on success and throws ProviderError(INVALID_CREDENTIALS) when the intent is missing', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: {
          case: 'idpIntent',
          value: { idpIntentId: 'i-1', idpIntentToken: 't-1', userId: 'z-1' },
        },
      }),
    });
    const r = await provider().startLdapIntent('idp-1', 'user', 'pw');
    expect(r).to.deep.equal({ idpIntentId: 'i-1', idpIntentToken: 't-1', userId: 'z-1' });

    stubClient({
      startIdentityProviderIntent: async () => ({ nextStep: { case: 'authUrl', value: 'x' } }),
    });
    try {
      await provider().startLdapIntent('idp-1', 'user', 'bad');
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).to.be.instanceOf(ProviderError);
      expect((err as { code: string }).code).to.equal('INVALID_CREDENTIALS');
    }
  });
});
