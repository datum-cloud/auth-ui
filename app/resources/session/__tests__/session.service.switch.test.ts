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
import { removeAccount, switchAccount } from '@/resources/session';
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

function switchForm(sessionId: string, requestId?: string): FormData {
  const form = new FormData();
  form.set('intent', 'switch');
  form.set('sessionId', sessionId);
  if (requestId !== undefined) form.set('requestId', requestId);
  return form;
}

function removeForm(sessionId: string, requestId?: string): FormData {
  const form = new FormData();
  form.set('intent', 'remove');
  form.set('sessionId', sessionId);
  if (requestId !== undefined) form.set('requestId', requestId);
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

describe('switchAccount — current ceremony requestId threading (datumctl OIDC hang)', () => {
  // A no-MFA user whose org seeds a non-zero skip window resolves to /signed-in (the same setup
  // as the nudge-suppression spec). The cookie entry carries NO requestId, so any requestId on
  // the destination must come from the CURRENT ceremony form field, not the stale cookie one.
  const user: User = { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' };

  function makeProvider(): FakeAuthProvider {
    const provider = new FakeAuthProvider({
      users: [user],
      authMethods: { u1: [] },
      settingsByOrg: { 'nudge-org': { mfaInitSkipLifetimeMs: 10_000 } },
    });
    provider.seedLiveSession({ id: 's1', token: 'tok-s1', user });
    return provider;
  }

  async function cookie(): Promise<string> {
    return mintCookie({
      id: 's1',
      token: 'tok-s1',
      loginName: 'alice@acme.test',
      organization: 'nudge-org',
    });
  }

  it('threads the CURRENT ceremony requestId onto the resolved /signed-in destination', async () => {
    const provider = makeProvider();
    const reqId = 'oidc_V3-current';

    const outcome = await switchAccount(
      provider,
      makeRequest(await cookie()),
      switchForm('s1', reqId)
    );

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toMatch(/^\/signed-in(\?|$)/);
    expect(outcome.location).toContain(`requestId=${encodeURIComponent(reqId)}`);
  });

  it('omits requestId when none is provided (standalone switch fallback unchanged)', async () => {
    const provider = makeProvider();

    const outcome = await switchAccount(provider, makeRequest(await cookie()), switchForm('s1'));

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toMatch(/^\/signed-in(\?|$)/);
    expect(outcome.location).not.toContain('requestId=');
  });

  it('ignores a non-allowlisted requestId (treated as no ceremony)', async () => {
    const provider = makeProvider();

    const outcome = await switchAccount(
      provider,
      makeRequest(await cookie()),
      switchForm('s1', 'evil_https://attacker.example')
    );

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toMatch(/^\/signed-in(\?|$)/);
    expect(outcome.location).not.toContain('requestId=');
  });
});

describe('switchAccount — "Needs re-authentication" recovery (stale/revoked session)', () => {
  // A switch target whose stored token no longer resolves — getSession throws a session-validity
  // error (NOT_FOUND / PERMISSION_DENIED / …) OR returns null — must NOT dead-end on a 500. The
  // user is routed to re-login for that identity, resuming any live ceremony, with the dead entry
  // dropped from the cookie. Only a genuinely transient backend failure still 500s.
  const user: User = { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' };

  async function cookie(): Promise<string> {
    return mintCookie({ id: 's1', token: 'tok-s1', loginName: 'alice@acme.test' });
  }

  it('redirects to /login (pre-filled loginName) when getSession returns null, not a 500', async () => {
    // No seeded live session → getSession returns null → re-auth recovery.
    const provider = new FakeAuthProvider({ users: [user] });
    const outcome = await switchAccount(provider, makeRequest(await cookie()), switchForm('s1'));

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toMatch(/^\/login(\?|$)/);
    expect(outcome.location).toContain('loginName=alice%40acme.test');
  });

  it('redirects to /login when getSession throws a session-validity error (e.g. NOT_FOUND)', async () => {
    const provider = new FakeAuthProvider({ users: [user] });
    provider.setSessionResult('s1', { mode: 'throw', code: 'NOT_FOUND' });
    const outcome = await switchAccount(provider, makeRequest(await cookie()), switchForm('s1'));

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toMatch(/^\/login(\?|$)/);
  });

  it('threads a live OIDC requestId onto the re-login redirect so the ceremony resumes', async () => {
    const provider = new FakeAuthProvider({ users: [user] });
    provider.setSessionResult('s1', { mode: 'throw', code: 'PERMISSION_DENIED' });
    const outcome = await switchAccount(
      provider,
      makeRequest(await cookie()),
      switchForm('s1', 'oidc_V3-current')
    );

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toMatch(/^\/login\?/);
    expect(outcome.location).toContain('requestId=oidc_V3-current');
  });

  it('routes a device-grant re-auth to /login?requestId=device_<code> (resumes the grant)', async () => {
    const provider = new FakeAuthProvider({ users: [user] });
    provider.setSessionResult('s1', { mode: 'null' });
    const form = switchForm('s1');
    form.set('userCode', 'LQWC-KMNH');
    const outcome = await switchAccount(provider, makeRequest(await cookie()), form);

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toContain('requestId=device_LQWC-KMNH');
  });

  it('still surfaces PROVIDER_ERROR 500 for a genuinely transient backend failure', async () => {
    const provider = new FakeAuthProvider({ users: [user] });
    provider.setSessionResult('s1', { mode: 'throw', code: 'UNAVAILABLE' });
    const outcome = await switchAccount(provider, makeRequest(await cookie()), switchForm('s1'));

    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') throw new Error('expected error');
    expect(outcome.error).toBe('PROVIDER_ERROR');
    expect(outcome.status).toBe(500);
  });
});

describe('removeAccount — ceremony requestId threading', () => {
  // removeAccount deletes the entry provider-side (best-effort, seeded so it succeeds) then
  // redirects back to /accounts. The CURRENT ceremony id must ride that redirect so removing an
  // account mid-ceremony keeps the flow — but only an allowlisted value is reflected (no injection).
  const user: User = { id: 'u1', loginName: 'alice@acme.test', displayName: 'Alice' };

  function makeProvider(): FakeAuthProvider {
    const provider = new FakeAuthProvider({ users: [user] });
    provider.seedLiveSession({ id: 's1', token: 'tok-s1', user });
    return provider;
  }

  async function cookie(): Promise<string> {
    return mintCookie({ id: 's1', token: 'tok-s1', loginName: 'alice@acme.test' });
  }

  it('carries an allowlisted requestId onto the /accounts redirect', async () => {
    const provider = makeProvider();
    const reqId = 'oidc_V3-current';

    const outcome = await removeAccount(
      provider,
      makeRequest(await cookie()),
      removeForm('s1', reqId)
    );

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toBe(`/accounts?requestId=${encodeURIComponent(reqId)}`);
  });

  it('redirects to bare /accounts when no requestId is provided', async () => {
    const provider = makeProvider();

    const outcome = await removeAccount(provider, makeRequest(await cookie()), removeForm('s1'));

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toBe('/accounts');
  });

  it('drops a non-allowlisted requestId (no injection onto /accounts)', async () => {
    const provider = makeProvider();

    const outcome = await removeAccount(
      provider,
      makeRequest(await cookie()),
      removeForm('s1', 'evil_x')
    );

    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') throw new Error('expected redirect');
    expect(outcome.location).toBe('/accounts');
  });
});
