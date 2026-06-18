import { resolveSignupView } from './signup-view';
import type { IdProvider, LoginSettings } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

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
    expect(resolveSignupView(base, idps, true)).toEqual({
      showIdpButtons: true,
      allowEmailEntry: true,
      showEmailLink: true,
      showPasskey: true,
      showPassword: false,
      registrationDisabled: false,
    });
  });
  it('adds password when allowPassword is on', () => {
    expect(resolveSignupView({ ...base, allowPassword: true }, idps, true).showPassword).toBe(true);
  });
  it('hides IdP buttons when no IdPs are active', () => {
    expect(resolveSignupView(base, [], true).showIdpButtons).toBe(false);
  });
  it('hides passkey when passkeysType is not allowed', () => {
    expect(
      resolveSignupView({ ...base, passkeysType: 'not_allowed' } as LoginSettings, idps, true)
        .showPasskey
    ).toBe(false);
  });
  it('disables email entry + link when disableLoginWithEmail', () => {
    const v = resolveSignupView(
      { ...base, disableLoginWithEmail: true } as LoginSettings,
      idps,
      true
    );
    expect(v.allowEmailEntry).toBe(false);
    expect(v.showEmailLink).toBe(false);
  });
  it('flags registrationDisabled when allowRegister is false', () => {
    expect(
      resolveSignupView({ ...base, allowRegister: false } as LoginSettings, idps, true)
        .registrationDisabled
    ).toBe(true);
  });
  it('hides email link when email delivery is disabled', () => {
    expect(resolveSignupView(base, idps, false).showEmailLink).toBe(false);
  });
  it('shows email link when email allowed AND delivery enabled', () => {
    expect(resolveSignupView(base, idps, true).showEmailLink).toBe(true);
  });
});
