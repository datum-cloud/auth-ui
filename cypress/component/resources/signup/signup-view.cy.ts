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
  it('adds password when allowPassword is on', () => {
    expect(resolveSignupView({ ...base, allowPassword: true }, idps, true).showPassword).to.equal(
      true
    );
  });
  it('hides IdP buttons when no IdPs are active', () => {
    expect(resolveSignupView(base, [], true).showIdpButtons).to.equal(false);
  });
  it('hides passkey when passkeysType is not allowed', () => {
    expect(
      resolveSignupView({ ...base, passkeysType: 'not_allowed' } as LoginSettings, idps, true)
        .showPasskey
    ).to.equal(false);
  });
  it('disables email entry + link when disableLoginWithEmail', () => {
    const v = resolveSignupView(
      { ...base, disableLoginWithEmail: true } as LoginSettings,
      idps,
      true
    );
    expect(v.allowEmailEntry).to.equal(false);
    expect(v.showEmailLink).to.equal(false);
  });
  it('flags registrationDisabled when allowRegister is false', () => {
    expect(
      resolveSignupView({ ...base, allowRegister: false } as LoginSettings, idps, true)
        .registrationDisabled
    ).to.equal(true);
  });
  it('hides email link when email delivery is disabled', () => {
    expect(resolveSignupView(base, idps, false).showEmailLink).to.equal(false);
  });
  it('shows email link when email allowed AND delivery enabled', () => {
    expect(resolveSignupView(base, idps, true).showEmailLink).to.equal(true);
  });
});
