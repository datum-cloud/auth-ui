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
      signupUnavailable: false,
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
      signupUnavailable: true,
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
      signupUnavailable: false,
    });
  });

  it('keeps allowEmailEntry when Zitadel policy allows email AND delivery is on', () => {
    expect(resolveSignupView(base, idps, true)).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: true,
      showEmailLink: true,
      showPasskey: true,
      showPassword: false,
      signupUnavailable: false,
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
      signupUnavailable: false,
    });
  });

  // --- signupUnavailable edge-case coverage ---

  it('signupUnavailable=true when allowRegister=false (policy disabled)', () => {
    const result = resolveSignupView(
      { ...base, allowRegister: false } as LoginSettings,
      idps,
      true
    );
    expect(result.signupUnavailable).to.equal(true);
  });

  it('signupUnavailable=true when allowRegister=true but no IdPs and email delivery off (blank index)', () => {
    // This is the new empty-state case: registration is allowed by policy but
    // there is no usable entry method on the index screen.
    const result = resolveSignupView(base, [], false);
    expect(result.signupUnavailable).to.equal(true);
  });

  it('signupUnavailable=false when allowRegister=true and an IdP is present (even if email delivery off)', () => {
    const result = resolveSignupView(base, idps, false);
    expect(result.signupUnavailable).to.equal(false);
  });

  it('signupUnavailable=false when allowRegister=true and email entry is available (even if no IdPs)', () => {
    const result = resolveSignupView(base, [], true);
    expect(result.signupUnavailable).to.equal(false);
  });
});
