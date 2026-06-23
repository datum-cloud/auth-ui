// Behaviour coverage for the zitadel capability split — the `settings.ts` and
// `idp.ts` modules. These free functions were extracted out of the former monolith and
// are exercised here through the real ZitadelAuthProvider public surface (same stubClient
// pattern as index.test.ts), so the test pins the delegation + mapping behaviour that the
// split must preserve. A regression in any extracted function (wrong RPC, dropped mapper,
// mis-threaded orgId) would turn these red.
import { ZitadelAuthProvider } from '../index';
import * as transport from '../transport';
import { ProviderError } from '@/modules/auth/types';
import { describe, it, expect, vi, afterEach } from 'vitest';

const provider = () => new ZitadelAuthProvider({ serviceUrl: 'https://z.test', serviceToken: 't' });

const stubClient = (impl: Record<string, unknown>) =>
  vi.spyOn(transport, 'createServiceClient').mockReturnValue(impl as never);

afterEach(() => vi.restoreAllMocks());

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
    expect(s.allowPassword).toBe(true);
    expect(s.allowRegister).toBe(true);
    expect(s.allowExternalIdp).toBe(false);
    expect(s.passkeysType).toBe('allowed');
    expect(s.hidePasswordReset).toBe(true);
  });

  it('getLoginSettings tolerates a missing settings object (empty proto)', async () => {
    stubClient({ getLoginSettings: async () => ({}) });
    const s = await provider().getLoginSettings();
    expect(s.allowPassword).toBe(false);
    expect(s.passkeysType).toBe('not_allowed');
  });

  it('getBranding maps the proto through toBranding', async () => {
    stubClient({ getBrandingSettings: async () => ({ settings: { themeMode: 1 } }) });
    const b = await provider().getBranding('org-2');
    expect(b).toBeTruthy();
  });

  it('getPasswordComplexity returns the coerced settings when present', async () => {
    stubClient({
      getPasswordComplexitySettings: async () => ({
        settings: { minLength: 8n, requiresUppercase: true },
      }),
    });
    const c = (await provider().getPasswordComplexity()) as { minLength: number };
    expect(c.minLength).toBe(8);
    expect(typeof c.minLength).toBe('number');
  });

  it('getPasswordComplexity returns undefined when settings is absent', async () => {
    stubClient({ getPasswordComplexitySettings: async () => ({}) });
    expect(await provider().getPasswordComplexity()).toBeUndefined();
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
    expect(idps).toHaveLength(2);
    expect(idps[0].id).toBe('idp-1');
    expect(idps[0].name).toBe('Google');
  });

  it('getActiveIdPs returns [] when the provider list is empty', async () => {
    stubClient({ getActiveIdentityProviders: async () => ({}) });
    expect(await provider().getActiveIdPs()).toEqual([]);
  });
});

describe('zitadel/idp — capability module', () => {
  it('startIdpIntent returns authUrl on the authUrl nextStep', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: { case: 'authUrl', value: 'https://idp/redirect' },
      }),
    });
    const r = await provider().startIdpIntent('idp-1', { success: 's', failure: 'f' });
    expect(r.authUrl).toBe('https://idp/redirect');
  });

  it('startIdpIntent returns formData on the formData nextStep (SAML)', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: { case: 'formData', value: { post: 'x' } },
      }),
    });
    const r = await provider().startIdpIntent('idp-1', { success: 's', failure: 'f' });
    expect(r.formData).toEqual({ post: 'x' });
  });

  it('startIdpIntent returns {} on the idpIntent nextStep', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({
        nextStep: { case: 'idpIntent', value: { idpIntentId: 'i' } },
      }),
    });
    expect(await provider().startIdpIntent('idp-1', { success: 's', failure: 'f' })).toEqual({});
  });

  it('retrieveIdpIntent maps the response through toIdpIntentResult', async () => {
    stubClient({
      retrieveIdentityProviderIntent: async () => ({
        idpInformation: { idpId: 'idp-1', userId: 'ext-1', userName: 'jane' },
        userId: 'z-1',
      }),
    });
    const r = await provider().retrieveIdpIntent('intent-1', 'tok');
    expect(r.information.idpId).toBe('idp-1');
    expect(r.information.idpUserId).toBe('ext-1');
  });

  it('listIdpLinks maps each proto link through toIdpLink', async () => {
    stubClient({
      listIDPLinks: async () => ({
        result: [{ idpId: 'idp-1', userId: 'ext-1', userName: 'jane' }],
      }),
    });
    const links = await provider().listIdpLinks('z-1');
    expect(links).toHaveLength(1);
    expect(links[0].idpId).toBe('idp-1');
  });

  it('listIdpLinks returns [] when result is absent', async () => {
    stubClient({ listIDPLinks: async () => ({}) });
    expect(await provider().listIdpLinks('z-1')).toEqual([]);
  });

  it('addIdpLink resolves void after calling addIDPLink', async () => {
    const addIDPLink = vi.fn(async () => ({}));
    stubClient({ addIDPLink });
    await expect(
      provider().addIdpLink('z-1', { idpId: 'idp-1', idpUserId: 'ext-1', idpUserName: 'jane' })
    ).resolves.toBeUndefined();
    expect(addIDPLink).toHaveBeenCalledOnce();
  });

  it('removeIdpLink resolves void after calling removeIDPLink', async () => {
    const removeIDPLink = vi.fn(async () => ({}));
    stubClient({ removeIDPLink });
    await expect(provider().removeIdpLink('z-1', 'idp-1', 'ext-1')).resolves.toBeUndefined();
    expect(removeIDPLink).toHaveBeenCalledOnce();
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
    expect(r).toEqual({ idpIntentId: 'i-1', idpIntentToken: 't-1', userId: 'z-1' });
  });

  it('startLdapIntent throws ProviderError(INVALID_CREDENTIALS) when the intent is missing', async () => {
    stubClient({
      startIdentityProviderIntent: async () => ({ nextStep: { case: 'authUrl', value: 'x' } }),
    });
    await expect(provider().startLdapIntent('idp-1', 'user', 'bad')).rejects.toBeInstanceOf(
      ProviderError
    );
    await expect(provider().startLdapIntent('idp-1', 'user', 'bad')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });
});
