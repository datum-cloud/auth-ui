// app/routes/setup.mfa.test.ts
//
// Bug C-setup (C6/C7): the MFA enrollment chooser must filter CAPABILITY_ROUTES by BOTH
// the provider's static capabilities AND the org login policy (secondFactors for
// u2f/totpOtp/emailOtp/smsOtp; multiFactors/passkey for the passkey row). When the policy
// sets are undefined (fake/older settings) it falls back to capabilities-only (back-compat).
import { offerableSetupRoutes } from './setup.mfa';
import type { LoginSettings, ProviderCapabilities } from '@/providers/types';
import { describe, it, expect } from 'vitest';

const ALL_CAPS: ProviderCapabilities = {
  passkey: true,
  u2f: true,
  totpOtp: true,
  emailOtp: true,
  smsOtp: true,
  externalIdp: true,
  ldap: true,
  saml: true,
  oidc: true,
  registration: true,
};

const settings = (over: Partial<LoginSettings> = {}): LoginSettings => ({
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: true,
  passkeysType: 'allowed',
  forceMfa: false,
  ...over,
});

// offerableSetupRoutes now returns the offerable capability KEYS directly (the loader needs a
// serializable shape — the route objects carry non-serializable JSX labels), so no .map here.
const keys = (caps: ProviderCapabilities, s: LoginSettings) => offerableSetupRoutes(caps, s);

describe('offerableSetupRoutes (setup.mfa policy gating)', () => {
  it('shows only authenticator + passkey when policy enables only TOTP (+ passkey via multiFactors)', () => {
    const s = settings({ secondFactors: ['totp'], multiFactors: ['passkey'] });
    expect(keys(ALL_CAPS, s)).toEqual(['passkey', 'totpOtp']);
  });

  it('drops the passkey row when the policy multiFactors does not include passkey', () => {
    const s = settings({ secondFactors: ['totp'], multiFactors: [] });
    expect(keys(ALL_CAPS, s)).toEqual(['totpOtp']);
  });

  it('falls back to capabilities-only when policy sets are undefined (back-compat)', () => {
    const s = settings(); // no secondFactors/multiFactors
    expect(keys(ALL_CAPS, s)).toEqual(['passkey', 'u2f', 'totpOtp', 'emailOtp', 'smsOtp']);
  });

  it('still respects capability gating: a policy-allowed method with no capability is hidden', () => {
    const caps: ProviderCapabilities = { ...ALL_CAPS, totpOtp: false };
    const s = settings({ secondFactors: ['totp', 'otp_email'], multiFactors: ['passkey'] });
    // totpOtp policy-allowed but capability off → hidden; emailOtp shown; passkey shown.
    expect(keys(caps, s)).toEqual(['passkey', 'emailOtp']);
  });

  it('maps each capability key to the right policy factor (u2f/email/sms)', () => {
    const s = settings({ secondFactors: ['u2f', 'otp_email', 'otp_sms'], multiFactors: [] });
    expect(keys(ALL_CAPS, s)).toEqual(['u2f', 'emailOtp', 'smsOtp']);
  });
});
