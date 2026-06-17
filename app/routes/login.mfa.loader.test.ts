// app/routes/login.mfa.loader.test.ts
// @vitest-environment node
//
// Must run in node env: happy-dom forbids setting the `Cookie` header on a Request
// (same reason as login.mfa.test.ts and device.authorize.test.ts).
//
// Bug C (C4): the MFA chooser loader must intersect the enrolled 2nd factors with the
// org login policy's allowed `secondFactors` before listing/short-circuiting, so a
// policy-disabled-but-still-enrolled method is never offered.
//
// Both cases drive the fake provider's OWN seeded data (no getLoginSettings mock):
//  - organization='totp-only-org' → settingsByOrg seeds secondFactors=['totp'] (Bug C seed).
//  - no organization → default fake settings leave secondFactors undefined (back-compat).
import { loader } from './login.mfa';
import { sessionsCookie } from '@/session/cookie';
import { describe, it, expect } from 'vitest';

const LOADER_URL = 'http://localhost/id/login/mfa';

async function mintSessionsCookie(loginName: string, organization?: string) {
  const entry = {
    id: 's1',
    token: 't1',
    loginName,
    organization,
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  return sessionsCookie.serialize([entry]);
}

async function runLoader(loginName: string, organization?: string) {
  const sessionsCookieHeader = await mintSessionsCookie(loginName, organization);
  const sessionsCookieValue = sessionsCookieHeader.split(';')[0];
  const params = new URLSearchParams({ loginName });
  if (organization) params.set('organization', organization);
  const req = new Request(`${LOADER_URL}?${params.toString()}`, {
    headers: { cookie: sessionsCookieValue },
  });
  return loader({ request: req, params: {}, context: {} as never } as never);
}

describe('login.mfa loader — policy-aware second-factor filtering (Bug C / C4)', () => {
  it('drops a policy-disabled enrolled factor and short-circuits to the remaining allowed one', async () => {
    // u7 (mfa2-user) is enrolled in [password, totp, otp_email]. The seeded 'totp-only-org'
    // policy allows only [totp] → after intersection only TOTP remains → loader redirects
    // straight to its use-screen (no chooser).
    const res = await runLoader('mfa2-user@acme.test', 'totp-only-org');

    expect(res).toBeInstanceOf(Response);
    const location = (res as Response).headers.get('location');
    expect(location).toContain('/login/verify/authenticator');
  });

  it('lists both enrolled factors when the policy does not restrict (secondFactors undefined, back-compat)', async () => {
    // No organization → default fake settings carry no secondFactors → enrolled-only behavior
    // (both methods shown).
    const res = await runLoader('mfa2-user@acme.test');

    // Not a redirect: loader returns data with both 2nd factors.
    expect(res).not.toBeInstanceOf(Response);
    const payload = (res as { data: { secondFactors: string[] } }).data;
    expect(payload.secondFactors).toEqual(expect.arrayContaining(['totp', 'otp_email']));
    expect(payload.secondFactors).toHaveLength(2);
  });
});
