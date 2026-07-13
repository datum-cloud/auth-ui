// cypress/component/resources/mfa/setup-mfa.cy.ts
//
// Component (no-mount) port of the PURE half of
// app/resources/mfa/__tests__/setup-mfa.service.test.ts — offerableSetupRoutes(caps, settings)
// is a pure capability×policy gate (Bug C-setup C6/C7), so it runs browser-side with Chai.
// The session-guarded resolveMfaSetup half is node-bound and lives in mfa.service.cy.ts.
import type { LoginSettings, ProviderCapabilities } from '@/modules/auth/types';
import { offerableSetupRoutes } from '@/resources/mfa';

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

// offerableSetupRoutes returns the offerable capability KEYS directly (serializable loader shape).
const keys = (caps: ProviderCapabilities, s: LoginSettings) => offerableSetupRoutes(caps, s);

describe('offerableSetupRoutes (setup.mfa policy gating)', () => {
  it('still respects capability gating: a policy-allowed method with no capability is hidden', () => {
    const caps: ProviderCapabilities = { ...ALL_CAPS, totpOtp: false };
    const s = settings({ secondFactors: ['totp', 'otp_email'], multiFactors: ['passkey'] });
    // totpOtp policy-allowed but capability off → hidden; emailOtp shown; passkey shown.
    expect(keys(caps, s)).to.deep.equal(['passkey', 'emailOtp']);
  });
});
