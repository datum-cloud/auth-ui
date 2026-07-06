// cypress/component/resources/signup/signup-view.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup-view.test.ts.
// Pure view resolver → browser-side Chai only.
import type { IdProvider, LoginSettings } from '@/modules/auth/types';
import { resolveSignupView } from '@/resources/signup/signup-view';

const base = {
  allowRegister: true,
  allowExternalIdp: true,
  allowPassword: false,
  passkeysType: 'allowed',
  disableLoginWithEmail: false,
} as unknown as LoginSettings;
const idps = [{ id: 'idp-g', name: 'Google', type: 'GOOGLE' }] as unknown as IdProvider[];

describe('resolveSignupView', () => {
  it('shows IdP buttons + email link + passkey, no password (passwordless org)', () => {
    expect(resolveSignupView(base, idps, true)).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: true,
      showEmailLink: true,
      showPasskey: true,
      showPassword: false,
      registrationDisabled: false,
    });
  });

  it('reflects allowPassword, missing IdPs, disabled passkeys, disabled registration, and disabled email delivery together', () => {
    expect(
      resolveSignupView(
        {
          ...base,
          allowPassword: true,
          passkeysType: 'not_allowed',
          allowRegister: false,
        } as LoginSettings,
        [],
        false
      )
    ).to.deep.equal({
      showIdpButtons: false,
      allowEmailEntry: false,
      showEmailLink: false,
      showPasskey: false,
      showPassword: true,
      registrationDisabled: true,
    });
  });

  it('hides email entry and link when emailDeliveryEnabled=false, regardless of Zitadel policy', () => {
    // RED→GREEN: before the fix allowEmailEntry was true when delivery was off.
    // With delivery off the whole email path must hide so signup is IdP-only.
    expect(resolveSignupView(base, idps, false)).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: false,
      showEmailLink: false,
      showPasskey: true,
      showPassword: false,
      registrationDisabled: false,
    });
  });

  it('keeps allowEmailEntry when Zitadel policy allows email AND delivery is on', () => {
    expect(resolveSignupView(base, idps, true)).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: true,
      showEmailLink: true,
      showPasskey: true,
      showPassword: false,
      registrationDisabled: false,
    });
  });

  it('hides email entry when Zitadel disableLoginWithEmail=true even if delivery is on', () => {
    expect(
      resolveSignupView({ ...base, disableLoginWithEmail: true } as LoginSettings, idps, true)
    ).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: false,
      showEmailLink: false,
      showPasskey: true,
      showPassword: false,
      registrationDisabled: false,
    });
  });
});
