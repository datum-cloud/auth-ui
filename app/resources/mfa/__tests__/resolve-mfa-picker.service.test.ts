// app/resources/mfa/__tests__/resolve-mfa-picker.service.test.ts
//
// Pass 2 service tests for the /login/mfa chooser loader logic. Ported from
// routes/login/__tests__/mfa.loader.test.ts — instead of driving the route loader via a
// sessions cookie + Request, these call resolveMfaPicker directly against the fake provider
// singleton with an in-memory SessionEntry list.
//
// Bug C (C4): the MFA chooser must intersect the enrolled 2nd factors with the org login
// policy's allowed `secondFactors` before listing/short-circuiting, so a
// policy-disabled-but-still-enrolled method is never offered.
//
// Both cases drive the fake provider's OWN seeded data (no getLoginSettings mock):
//  - organization='totp-only-org' → settingsByOrg seeds secondFactors=['totp'] (Bug C seed).
//  - no organization → default fake settings leave secondFactors undefined (back-compat).
import { resolveMfaPicker } from '@/resources/mfa';
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import type { SessionEntry } from '@/modules/auth/session/cookie';
import { describe, it, expect } from 'vitest';

function fakeProvider(): FakeAuthProvider {
  return getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
}

/** A single valid session entry for the given loginName (mirrors the cookie the route reads). */
function sessions(loginName: string, organization?: string): SessionEntry[] {
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

describe('resolveMfaPicker — policy-aware second-factor filtering (Bug C / C4)', () => {
  it('drops a policy-disabled enrolled factor and short-circuits to the remaining allowed one', async () => {
    // u7 (mfa2-user) is enrolled in [password, totp, otp_email]. The seeded 'totp-only-org'
    // policy allows only [totp] → after intersection only TOTP remains → service redirects
    // straight to its use-screen (no chooser).
    const res = await resolveMfaPicker(fakeProvider(), sessions('mfa2-user@acme.test', 'totp-only-org'), {
      loginName: 'mfa2-user@acme.test',
      organization: 'totp-only-org',
    });

    expect(res.kind).toBe('redirect');
    if (res.kind === 'redirect') {
      expect(res.target).toContain('/login/verify/authenticator');
    }
  });

  it('lists both enrolled factors when the policy does not restrict (secondFactors undefined, back-compat)', async () => {
    // No organization → default fake settings carry no secondFactors → enrolled-only behavior
    // (both methods shown).
    const res = await resolveMfaPicker(fakeProvider(), sessions('mfa2-user@acme.test'), {
      loginName: 'mfa2-user@acme.test',
    });

    // Not a redirect: service returns the picker with both 2nd factors.
    expect(res.kind).toBe('picker');
    if (res.kind === 'picker') {
      expect(res.secondFactors).toEqual(expect.arrayContaining(['totp', 'otp_email']));
      expect(res.secondFactors).toHaveLength(2);
    }
  });
});
