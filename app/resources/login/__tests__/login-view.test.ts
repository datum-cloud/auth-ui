import type { IdProvider } from '@/modules/auth/types';
import {
  resolveLoginView,
  attemptsRemaining,
  resolveIdentifierField,
} from '@/resources/login/login-view';
import { describe, it, expect } from 'vitest';

const settings = (
  o: Partial<{
    allowPassword: boolean;
    allowRegister: boolean;
    allowExternalIdp: boolean;
    passkeysAllowed: boolean;
    disableLoginWithEmail: boolean;
  }>
) => ({
  allowPassword: o.allowPassword ?? false,
  allowRegister: o.allowRegister ?? false,
  allowExternalIdp: o.allowExternalIdp ?? false,
  passkeysType: o.passkeysAllowed ? ('allowed' as const) : ('not_allowed' as const),
  disableLoginWithEmail: o.disableLoginWithEmail ?? false,
});
const idp: IdProvider = { id: 'idp-1', name: 'Google', type: 'GOOGLE' };

describe('resolveLoginView', () => {
  it('shows the password form only when allowPassword', () => {
    expect(resolveLoginView(settings({ allowPassword: true }), [], true).showPasswordForm).toBe(
      true
    );
    expect(resolveLoginView(settings({ allowPassword: false }), [], true).showPasswordForm).toBe(
      false
    );
  });
  it('shows IdP buttons only when allowExternalIdp AND at least one idp', () => {
    expect(resolveLoginView(settings({ allowExternalIdp: true }), [idp], true).showIdpButtons).toBe(
      true
    );
    expect(resolveLoginView(settings({ allowExternalIdp: true }), [], true).showIdpButtons).toBe(
      false
    );
    expect(
      resolveLoginView(settings({ allowExternalIdp: false }), [idp], true).showIdpButtons
    ).toBe(false);
  });
  it('shows the register link only when allowRegister', () => {
    expect(resolveLoginView(settings({ allowRegister: true }), [], true).showRegisterLink).toBe(
      true
    );
    expect(resolveLoginView(settings({ allowRegister: false }), [], true).showRegisterLink).toBe(
      false
    );
  });
  it('surfaces the passkey prompt only when passkeys are allowed', () => {
    expect(resolveLoginView(settings({ passkeysAllowed: true }), [], true).showPasskeyPrompt).toBe(
      true
    );
    expect(resolveLoginView(settings({ passkeysAllowed: false }), [], true).showPasskeyPrompt).toBe(
      false
    );
  });
  it('flags sign-in unavailable when neither password, IdP, nor passkey is offered', () => {
    expect(resolveLoginView(settings({}), [], true).signInUnavailable).toBe(true);
    expect(resolveLoginView(settings({ allowPassword: true }), [], true).signInUnavailable).toBe(
      false
    );
    expect(
      resolveLoginView(settings({ allowExternalIdp: true }), [idp], true).signInUnavailable
    ).toBe(false);
  });
  it('passkey-only (no password, no IdP) is NOT unavailable', () => {
    const v = resolveLoginView(settings({ passkeysAllowed: true }), [], true);
    expect(v.signInUnavailable).toBe(false);
    expect(v.showPasskeyPrompt).toBe(true);
  });
  it('shows the email-link affordance by default', () => {
    expect(resolveLoginView(settings({}), [], true).showEmailLink).toBe(true);
    expect(
      resolveLoginView(settings({ disableLoginWithEmail: false }), [], true).showEmailLink
    ).toBe(true);
  });
  it('hides the email-link affordance when disableLoginWithEmail is set', () => {
    expect(
      resolveLoginView(settings({ disableLoginWithEmail: true }), [], true).showEmailLink
    ).toBe(false);
  });
  it('hides email link when email delivery is disabled', () => {
    expect(resolveLoginView(settings({}), [], false).showEmailLink).toBe(false);
  });
  it('shows email link when email allowed AND delivery enabled', () => {
    expect(resolveLoginView(settings({}), [], true).showEmailLink).toBe(true);
  });
});

describe('attemptsRemaining', () => {
  it('returns null when counts are absent', () => {
    expect(attemptsRemaining(undefined, undefined)).toBeNull();
    expect(attemptsRemaining(2, undefined)).toBeNull();
    expect(attemptsRemaining(undefined, 5)).toBeNull();
  });
  it('reports remaining attempts before lockout', () => {
    expect(attemptsRemaining(2, 5)).toEqual({ kind: 'remaining', count: 3 });
    expect(attemptsRemaining(4, 5)).toEqual({ kind: 'remaining', count: 1 });
  });
  it('reports locked at or beyond the max', () => {
    expect(attemptsRemaining(5, 5)).toEqual({ kind: 'locked' });
    expect(attemptsRemaining(6, 5)).toEqual({ kind: 'locked' });
  });
});

describe('resolveIdentifierField', () => {
  it('email+phone allowed (both flags off) → today default', () => {
    expect(resolveIdentifierField({})).toEqual({
      allowEmail: true,
      allowPhone: true,
      rejectPhone: false,
    });
  });
  it('phone disabled → allowPhone false + rejectPhone true', () => {
    expect(resolveIdentifierField({ disableLoginWithPhone: true })).toEqual({
      allowEmail: true,
      allowPhone: false,
      rejectPhone: true,
    });
  });
  it('email disabled → allowEmail false, phone still allowed', () => {
    expect(resolveIdentifierField({ disableLoginWithEmail: true })).toEqual({
      allowEmail: false,
      allowPhone: true,
      rejectPhone: false,
    });
  });
  it('both disabled → username only + rejectPhone', () => {
    expect(
      resolveIdentifierField({ disableLoginWithEmail: true, disableLoginWithPhone: true })
    ).toEqual({
      allowEmail: false,
      allowPhone: false,
      rejectPhone: true,
    });
  });
});
