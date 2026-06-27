// cypress/component/modules/auth/providers/zitadel/settings-idp.behavior.cy.ts
//
// Component (no-mount) port of app/modules/auth/providers/zitadel/__tests__/settings-idp.behavior.test.ts.
// Exercises the settings.ts and idp.ts capability modules via the ZitadelAuthProvider public surface
// using the same __setCreateServiceClientImpl hook as index.cy.ts.
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
  it('getLoginSettings maps the proto flags through toLoginSettings', async () => {
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
    expect(s.allowRegister).to.equal(true);
    expect(s.allowExternalIdp).to.equal(false);
    expect(s.passkeysType).to.equal('allowed');
    expect(s.hidePasswordReset).to.equal(true);
  });

  it('getLoginSettings tolerates a missing settings object (empty proto)', async () => {
    stubClient({ getLoginSettings: async () => ({}) });
    const s = await provider().getLoginSettings();
    expect(s.allowPassword).to.equal(false);
    expect(s.passkeysType).to.equal('not_allowed');
  });

  it('getBranding maps the proto through toBranding', async () => {
    stubClient({ getBrandingSettings: async () => ({ settings: { themeMode: 1 } }) });
    const b = await provider().getBranding('org-2');
    expect(b).to.be.ok;
  });

  it('getPasswordComplexity returns the coerced settings when present', async () => {
    stubClient({
      getPasswordComplexitySettings: async () => ({
        settings: { minLength: 8n, requiresUppercase: true },
      }),
    });
    const c = (await provider().getPasswordComplexity()) as { minLength: number };
    expect(c.minLength).to.equal(8);
    expect(typeof c.minLength).to.equal('number');
  });

  it('getPasswordComplexity returns undefined when settings is absent', async () => {
    stubClient({ getPasswordComplexitySettings: async () => ({}) });
    expect(await provider().getPasswordComplexity()).to.be.undefined;
  });

  // getLegalSupport removed from the port (zero callers) — test dropped.

  it('getActiveIdPs maps each identity provider through toIdProvider', async () => {
    stubClient({
      getActiveIdentityProviders: async () => ({
        identityProviders: [
          { id: 'idp-1', name: 'Google', type: 6 },
          { id: 'idp-2', name: 'GitHub', type: 9 },
        ],
      }),
    });
    const idps = await provider().getActiveIdPs('org-4');
    expect(idps).to.have.length(2);
    expect(idps[0].id).to.equal('idp-1');
    expect(idps[0].name).to.equal('Google');
  });

  it('getActiveIdPs returns [] when the provider list is empty', async () => {
    stubClient({ getActiveIdentityProviders: async () => ({}) });
    expect(await provider().getActiveIdPs()).to.deep.equal([]);
  });
});

// ── idp capability module ──────────────────────────────────────────────────────

describe('zitadel/idp — capability module', () => {
  it('startIdpIntent returns authUrl on the authUrl nextStep', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: { case: 'authUrl', value: 'https://idp/redirect' },
      }),
    });
    const r = await provider().startIdpIntent('idp-1', { success: 's', failure: 'f' });
    expect(r.authUrl).to.equal('https://idp/redirect');
  });

  it('startIdpIntent returns formData on the formData nextStep (SAML)', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: { case: 'formData', value: { post: 'x' } },
      }),
    });
    const r = await provider().startIdpIntent('idp-1', { success: 's', failure: 'f' });
    expect(r.formData).to.deep.equal({ post: 'x' });
  });

  it('startIdpIntent returns {} on the idpIntent nextStep', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: { case: 'idpIntent', value: { idpIntentId: 'i' } },
      }),
    });
    const r = await provider().startIdpIntent('idp-1', { success: 's', failure: 'f' });
    expect(r).to.deep.equal({});
  });

  it('retrieveIdpIntent maps the response through toIdpIntentResult', async () => {
    stubClient({
      retrieveIdentityProviderIntent: async () => ({
        idpInformation: { idpId: 'idp-1', userId: 'ext-1', userName: 'jane' },
        userId: 'z-1',
      }),
    });
    const r = await provider().retrieveIdpIntent('intent-1', 'tok');
    expect(r.information.idpId).to.equal('idp-1');
    expect(r.information.idpUserId).to.equal('ext-1');
  });

  it('listIdpLinks maps each proto link through toIdpLink', async () => {
    stubClient({
      listIDPLinks: async () => ({
        result: [{ idpId: 'idp-1', userId: 'ext-1', userName: 'jane' }],
      }),
    });
    const links = await provider().listIdpLinks('z-1');
    expect(links).to.have.length(1);
    expect(links[0].idpId).to.equal('idp-1');
  });

  it('listIdpLinks returns [] when result is absent', async () => {
    stubClient({ listIDPLinks: async () => ({}) });
    expect(await provider().listIdpLinks('z-1')).to.deep.equal([]);
  });

  it('addIdpLink resolves void after calling addIDPLink', async () => {
    const impl = { addIDPLink: async () => ({}) };
    const addIDPLinkSpy = cy.stub(impl, 'addIDPLink').resolves({});
    stubClient(impl);
    await provider().addIdpLink('z-1', { idpId: 'idp-1', idpUserId: 'ext-1', idpUserName: 'jane' });
    expect(addIDPLinkSpy).to.have.callCount(1);
  });

  it('removeIdpLink resolves void after calling removeIDPLink', async () => {
    const impl = { removeIDPLink: async () => ({}) };
    const removeIDPLinkSpy = cy.stub(impl, 'removeIDPLink').resolves({});
    stubClient(impl);
    await provider().removeIdpLink('z-1', 'idp-1', 'ext-1');
    expect(removeIDPLinkSpy).to.have.callCount(1);
  });

  it('startLdapIntent returns the intent tuple on the idpIntent nextStep', async () => {
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
  });

  it('startLdapIntent throws ProviderError(INVALID_CREDENTIALS) when the intent is missing', () => {
    stubClient({
      startIdentityProviderIntent: async () => ({ nextStep: { case: 'authUrl', value: 'x' } }),
    });
    return provider()
      .startLdapIntent('idp-1', 'user', 'bad')
      .then(
        () => {
          throw new Error('expected rejection');
        },
        (err) => {
          expect(err).to.be.instanceOf(ProviderError);
          expect(err.code).to.equal('INVALID_CREDENTIALS');
        }
      );
  });
});
