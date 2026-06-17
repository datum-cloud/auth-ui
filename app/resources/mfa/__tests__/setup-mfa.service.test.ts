// app/resources/mfa/__tests__/setup-mfa.service.test.ts
//
// Pass 2 service tests for the /setup/mfa enrollment-chooser gating. Ported verbatim
// from routes/setup/__tests__/mfa.test.ts — the assertions now call offerableSetupRoutes
// through the mfa service rather than the route module.
//
// Bug C-setup (C6/C7): the MFA enrollment chooser must filter by BOTH the provider's static
// capabilities AND the org login policy (secondFactors for u2f/totpOtp/emailOtp/smsOtp;
// multiFactors/passkey for the passkey row). When the policy sets are undefined (fake/older
// settings) it falls back to capabilities-only (back-compat).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import type { SessionEntry } from '@/modules/auth/session/cookie';
import type { LoginSettings, ProviderCapabilities } from '@/modules/auth/types';
import { offerableSetupRoutes, resolveMfaSetup } from '@/resources/mfa';
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

// offerableSetupRoutes returns the offerable capability KEYS directly (the loader needs a
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

// ─── resolveMfaSetup loader guard chain ───────────────────────────────────────
//
// The /setup/mfa loader was thinned to delegate its session + user guards and the
// capability/policy gating to resolveMfaSetup (mirroring resolveMfaPicker). These cover
// that extracted guard chain against the fake provider singleton with an in-memory
// SessionEntry list — the CSRF/header wiring stays route-level and is not exercised here.

function fakeProvider(): FakeAuthProvider {
  return getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
}

/** A single valid session entry for the given loginName (mirrors the cookie the route reads). */
function session(loginName: string, organization?: string): SessionEntry[] {
  return [
    {
      id: 's1',
      token: 't1',
      loginName,
      organization,
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: '2099-01-01T00:00:00.000Z',
      changeTs: '2026-01-01T00:00:00.000Z',
    },
  ];
}

describe('resolveMfaSetup (setup.mfa loader guards + gating)', () => {
  it('redirects to /login when there is no session for the loginName', async () => {
    const res = await resolveMfaSetup(fakeProvider(), [], {
      loginName: 'mfa2-user@acme.test',
    });

    expect(res.kind).toBe('redirect');
    if (res.kind === 'redirect') expect(res.target).toBe('/login');
  });

  it('redirects to /login when the user does not exist for a valid session', async () => {
    const res = await resolveMfaSetup(fakeProvider(), session('ghost@acme.test'), {
      loginName: 'ghost@acme.test',
    });

    expect(res.kind).toBe('redirect');
    if (res.kind === 'redirect') expect(res.target).toBe('/login');
  });

  it('returns the offerable enrollment keys (capability + policy gated) for a valid session+user', async () => {
    // No organization → default fake settings carry no secondFactors/multiFactors →
    // capabilities-only gating. Singleton caps enable passkey/totpOtp/emailOtp (u2f/smsOtp off).
    const res = await resolveMfaSetup(fakeProvider(), session('mfa2-user@acme.test'), {
      loginName: 'mfa2-user@acme.test',
    });

    expect(res.kind).toBe('setup');
    if (res.kind === 'setup') {
      expect(res.offerableKeys).toEqual(['passkey', 'totpOtp', 'emailOtp']);
    }
  });
});
