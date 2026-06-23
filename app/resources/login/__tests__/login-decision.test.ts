// app/resources/login/__tests__/login-decision.test.ts
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

// decideAfterIdentifier always runs in the PRIMARY role. The context is threaded
// explicitly (not inferred from a sentinel param); behavior is unchanged.
const PRIMARY = { role: 'primary' } as const;

// The `decisionTarget`/`decisionError` compat shims are deleted — assertions
// read the discriminated Decision union directly (`d.kind` + `d.path` / `d.error`).
describe('decideAfterIdentifier → discriminated Decision union', () => {
  it('routes a password-only user to /login/password', () => {
    const methods: AuthMethod[] = ['password'];
    const d = decideAfterIdentifier({
      methods,
      settings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'redirect', path: '/login/password' });
  });
  it('routes to /login/method when 2+ primary methods are available (was: prefers passkey)', () => {
    // CHANGED: ['password','passkey'] previously routed directly to /login/passkey.
    // With the chooser logic, 2 available primary methods now yield /login/method instead.
    const methods: AuthMethod[] = ['password', 'passkey'];
    const d = decideAfterIdentifier({
      methods,
      settings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'redirect', path: '/login/method' });
  });
  it('routes to /verify (invite) when the user has no auth methods', () => {
    const d = decideAfterIdentifier({
      methods: [],
      settings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'redirect', path: '/verify' });
  });
  it('errors when password is the only method but allowPassword is false', () => {
    const d = decideAfterIdentifier({
      methods: ['password'],
      settings: { ...settings, allowPassword: false },
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'error', error: 'PASSWORD_NOT_ALLOWED' });
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
      context: PRIMARY,
    });
    // idp is disallowed → fall through to the password branch, not /sso.
    expect(d).toEqual({ kind: 'redirect', path: '/login/password' });
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
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'redirect', path: '/sso' });
  });

  // ── new cases for email-OTP primary routing ──────────────────────────────
  const s = {
    allowPassword: true,
    allowExternalIdp: true,
    passkeysType: 'allowed',
  } as LoginSettings;

  it('routes an email-only user to /login/verify/email (otp_email as PRIMARY, mfa role excluded)', () => {
    // otp_email here is the PRIMARY method (role: 'primary'), the same target it would
    // reach as a second factor — but the role is now explicit at the call boundary.
    const d = decideAfterIdentifier({
      methods: ['otp_email'],
      settings: s,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'redirect', path: '/login/verify/email' });
  });
  it('routes a 2+ primary-method user to /login/method', () => {
    const d = decideAfterIdentifier({
      methods: ['passkey', 'otp_email'],
      settings: s,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'redirect', path: '/login/method' });
  });
  it('keeps single-method password routing unchanged', () => {
    const d = decideAfterIdentifier({
      methods: ['password'],
      settings: s,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'redirect', path: '/login/password' });
  });

  it('excludes otp_email as a primary when email delivery is off', () => {
    const d = decideAfterIdentifier({
      methods: ['otp_email'],
      settings: s,
      emailDeliveryEnabled: false,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'error', error: 'NO_SUPPORTED_METHOD' });
  });
  it('keeps otp_email when delivery is on', () => {
    const d = decideAfterIdentifier({
      methods: ['otp_email'],
      settings: s,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).toEqual({ kind: 'redirect', path: '/login/verify/email' });
  });
});
