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
    expect(decideAfterIdentifier({ methods, settings }).target).toBe('/login/password');
  });
  it('prefers passkey when available (Phase 4 screen)', () => {
    const methods: AuthMethod[] = ['password', 'passkey'];
    expect(decideAfterIdentifier({ methods, settings }).target).toBe('/login/passkey');
  });
  it('routes to /verify (invite) when the user has no auth methods', () => {
    expect(decideAfterIdentifier({ methods: [], settings }).target).toBe('/verify');
  });
  it('errors when password is the only method but allowPassword is false', () => {
    const r = decideAfterIdentifier({
      methods: ['password'],
      settings: { ...settings, allowPassword: false },
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
    });
    expect(d.target).toBe('/sso');
  });
});
