// app/resources/session/__tests__/session.service.switch.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom forbids setting the `Cookie` header on a
// Request, and switchAccount reads the signed sessions cookie off the request.
//
// 755-M10 · "Switch account" must NOT re-fire the skippable MFA-setup nudge.
//
// switchAccount → resolveNextPath → nextStepWithParams → nextStep → nextMfaStep. On a
// no-2nd-factor user whose org has a non-zero `mfaInitSkipLifetimeMs` and who never skipped,
// the shared engine would route to /setup/mfa?force=false (step 6). The switch path threads
// `suppressMfaSetupNudge: true`, collapsing ONLY that step to the continuation (/signed-in).
//
// The forced-MFA path (step 5, settings.forceMfa via the seeded `force-org`) is the control:
// switching into a forced-MFA org STILL routes to forced setup — suppression only skips the
// optional nudge, never a real requirement.
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import type { User } from '@/modules/auth/types';
import { switchAccount } from '@/resources/session';
import { describe, it, expect } from 'vitest';

const BASE_URL = 'http://localhost/id/accounts';

/** Build a signed sessions cookie carrying a single live entry. */
async function mintCookie(entry: {
  id: string;
  token: string;
  loginName: string;
  organization?: string;
}): Promise<string> {
  return sessionsCookie.serialize([
    {
      id: entry.id,
      token: entry.token,
      loginName: entry.loginName,
      organization: entry.organization,
      creationTs: '2026-01-01T00:00:00.000Z',
      expirationTs: '2099-01-01T00:00:00.000Z',
      changeTs: '2026-01-01T00:00:00.000Z',
    },
  ]);
}

/** A request carrying ONLY the sessions cookie (mirrors the other accounts specs). */
function makeRequest(cookie: string): Request {
  return new Request(BASE_URL, { headers: { cookie: cookie.split(';')[0] } });
}

function switchForm(sessionId: string): FormData {
  const form = new FormData();
  form.set('intent', 'switch');
  form.set('sessionId', sessionId);
  return form;
}

describe('switchAccount — 755-M10 MFA-setup nudge suppression', () => {
  it('switches a no-MFA user to /signed-in instead of the skippable /setup/mfa nudge', async () => {
    // The org seeds a non-zero skip window + the user never skipped → on a FRESH login this
    // exact state routes to /setup/mfa?force=false. The switch path must collapse it to
    // /signed-in.
    const user: User = { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' };
    const provider = new FakeAuthProvider({
      users: [user],
      authMethods: { u1: [] }, // no enrolled 2nd factor
      settingsByOrg: { 'nudge-org': { mfaInitSkipLifetimeMs: 10_000 } },
    });
    provider.seedLiveSession({ id: 's1', token: 'tok-s1', user });

    const cookie = await mintCookie({
      id: 's1',
      token: 'tok-s1',
      loginName: 'alice@acme.test',
      organization: 'nudge-org',
    });

    const outcome = await switchAccount(provider, makeRequest(cookie), switchForm('s1'));

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    // Lands on the continuation/signed-in destination (ceremony params may be appended),
    // NOT the skippable MFA-setup nudge.
    expect(outcome.location).toMatch(/^\/signed-in(\?|$)/);
    expect(outcome.location).not.toContain('/setup/mfa');
  });

  it('still routes a forceMfa-org switch to forced /setup/mfa (real requirement preserved)', async () => {
    // The `force-org` override (forceMfa=true) is a REAL step-5 requirement. Suppressing the
    // step-6 nudge must NOT skip it — switching into the org still lands on forced setup.
    const user: User = { id: 'u2', loginName: 'bob@acme.test', displayName: 'Bob' };
    const provider = new FakeAuthProvider({
      users: [user],
      authMethods: { u2: [] }, // no enrolled 2nd factor → forced setup applies
      settingsByOrg: { 'force-org': { forceMfa: true } },
    });
    provider.seedLiveSession({ id: 's2', token: 'tok-s2', user });

    const cookie = await mintCookie({
      id: 's2',
      token: 'tok-s2',
      loginName: 'bob@acme.test',
      organization: 'force-org',
    });

    const outcome = await switchAccount(provider, makeRequest(cookie), switchForm('s2'));

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toContain('/setup/mfa');
    expect(outcome.location).toContain('force=true');
    expect(outcome.location).toContain('checkAfter=true');
  });
});
