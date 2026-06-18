// app/flows/login-decision.test.ts
import { decideAfterIdentifier } from '../login-decision';
import type { AuthMethod, LoginSettings } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

const settings: LoginSettings = {
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: true,
  passkeysType: 'allowed',
  forceMfa: false,
};

describe('decideAfterIdentifier', () => {
  it('routes a password-only user to /login/password', () => {
    const methods: AuthMethod[] = ['password'];
    expect(decideAfterIdentifier({ methods, settings, emailDeliveryEnabled: true }).target).toBe(
      '/login/password'
    );
  });
  it('routes to /login/method when 2+ primary methods are available (was: prefers passkey)', () => {
    // CHANGED: ['password','passkey'] previously routed directly to /login/passkey.
    // With the chooser logic, 2 available primary methods now yield /login/method instead.
    const methods: AuthMethod[] = ['password', 'passkey'];
    expect(decideAfterIdentifier({ methods, settings, emailDeliveryEnabled: true }).target).toBe(
      '/login/method'
    );
  });
  it('routes to /verify (invite) when the user has no auth methods', () => {
    expect(
      decideAfterIdentifier({ methods: [], settings, emailDeliveryEnabled: true }).target
    ).toBe('/verify');
  });
  it('errors when password is the only method but allowPassword is false', () => {
    const r = decideAfterIdentifier({
      methods: ['password'],
      settings: { ...settings, allowPassword: false },
      emailDeliveryEnabled: true,
    });
    expect(r.target).toBe('/error');
  });

  it('does NOT route to /sso when allowExternalIdp is false (policy gate)', () => {
    const d = decideAfterIdentifier({
      methods: ['idp', 'password'],
      settings: {
        allowPassword: true,
        allowExternalIdp: false,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
    });
    // idp is disallowed → fall through to the password branch, not /sso.
    expect(d.target).toBe('/login/password');
  });

  it('routes to /sso when allowExternalIdp is true and idp is enrolled', () => {
    const d = decideAfterIdentifier({
      methods: ['idp'],
      settings: {
        allowPassword: true,
        allowExternalIdp: true,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
    });
    expect(d.target).toBe('/sso');
  });

  // ── new cases for email-OTP primary routing ──────────────────────────────
  const s = {
    allowPassword: true,
    allowExternalIdp: true,
    passkeysType: 'allowed',
  } as LoginSettings;

  it('routes an email-only user to /login/verify/email', () => {
    expect(
      decideAfterIdentifier({ methods: ['otp_email'], settings: s, emailDeliveryEnabled: true })
        .target
    ).toBe('/login/verify/email');
  });
  it('routes a 2+ primary-method user to /login/method', () => {
    expect(
      decideAfterIdentifier({
        methods: ['passkey', 'otp_email'],
        settings: s,
        emailDeliveryEnabled: true,
      }).target
    ).toBe('/login/method');
  });
  it('keeps single-method password routing unchanged', () => {
    expect(
      decideAfterIdentifier({ methods: ['password'], settings: s, emailDeliveryEnabled: true })
        .target
    ).toBe('/login/password');
  });

  it('excludes otp_email as a primary when email delivery is off', () => {
    expect(
      decideAfterIdentifier({ methods: ['otp_email'], settings: s, emailDeliveryEnabled: false })
        .target
    ).toBe('/error');
  });
  it('keeps otp_email when delivery is on', () => {
    expect(
      decideAfterIdentifier({ methods: ['otp_email'], settings: s, emailDeliveryEnabled: true })
        .target
    ).toBe('/login/verify/email');
  });
});
