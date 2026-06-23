// app/resources/device/__tests__/device.service.test.ts
// @vitest-environment node
//
// Must run in the node environment: happy-dom enforces the Fetch spec rule that forbids setting
// the `Cookie` header on a Request object, which breaks the sessions-cookie round-trip the
// authorize-decision tests rely on (same reasoning as the original route tests).
//
// Pass 2: service-level rewrite of the former routes/device/__tests__/{device,authorize}.test.ts.
// Every behavioral assertion from those route tests is preserved here, asserted directly at the
// service boundary (typed outcomes) plus a thin check that the *toResponse translators emit the
// same Response status/payload the routes return verbatim.
//
// CSRF is route-level wiring (assertCsrf stays in the thin route), so the service is called with a
// parsed FormData — no CSRF round-trip is needed here. (The original route tests minted CSRF only
// to satisfy the route's assertCsrf; the business logic under test is unchanged.)
//
// STATE HAZARD: the fake provider is a process-wide singleton. Each state-mutating test uses a
// DISTINCT seeded deviceAuthId so mutation is per-path isolated:
//   dev-authorize → authorize path (this file only; dev-1 is untouched)
//   dev-deny      → deny path
// Never assert isDeviceAuthorized(id) === false for an id another test may have authorized. dev-1
// is used READ-ONLY by the loader test (user-code resolution).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { getAuthProvider } from '@/modules/auth/select.server';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import {
  lookupDeviceCode,
  lookupOutcomeToResponse,
  loadDeviceConsent,
  deviceConsentErrorToResponse,
  resolveDeviceDecision,
  decisionOutcomeToResponse,
} from '@/resources/device';
import { describe, it, expect } from 'vitest';

function fakeProvider(): FakeAuthProvider {
  return getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;
}

/** Build a FormData body for the device actions (CSRF is asserted in the thin route, not here). */
function formData(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

/** Serialize a sessions cookie with a single valid entry, then attach it to a Request. */
async function requestWithSession(url: string, loginName = 'alice@acme.test'): Promise<Request> {
  const entry = {
    id: 's1',
    token: 't1',
    loginName,
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  const cookie = await sessionsCookie.serialize([entry]);
  // Strip Set-Cookie attributes; keep only the name=value pair.
  const cookieValue = cookie.split(';')[0];
  return new Request(url, { headers: { cookie: cookieValue } });
}

// ── /device action → lookupDeviceCode (from device.test.ts) ───────────────────────

describe('lookupDeviceCode (/device action)', () => {
  it('valid user code → redirect to /device/authorize with requestId and user_code', async () => {
    const outcome = await lookupDeviceCode(fakeProvider(), formData({ userCode: 'WDJB-MJHT' }));

    expect(outcome.kind).toBe('redirect');
    const location = outcome.kind === 'redirect' ? outcome.location : '';
    expect(location).toContain('/device/authorize');
    // requestId carries the STABLE user code, not the device-auth id: the real Zitadel adapter
    // returns a different opaque id per getDeviceAuth call, so the user code is the only handle
    // the ceremony can re-resolve after login.
    expect(location).toContain('requestId=device_WDJB-MJHT');
    expect(location).toContain('user_code=WDJB-MJHT');

    // Route-level wiring: the translator emits a 302 redirect to that location.
    const res = lookupOutcomeToResponse(outcome) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/device/authorize');
  });

  it('unknown user code → not a redirect; not_found error with status 404', async () => {
    const outcome = await lookupDeviceCode(fakeProvider(), formData({ userCode: 'NOPE' }));

    // Must NOT be a redirect
    expect(outcome.kind).toBe('error');
    expect(outcome.kind === 'error' && outcome.error).toBe('not_found');
    expect(outcome.kind === 'error' && outcome.status).toBe(404);

    // Route-level wiring: data() object carries { error: 'not_found' } with init status 404 and
    // is NOT a 302 Response.
    const res = lookupOutcomeToResponse(outcome);
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(404);
    expect(asData.data?.error).toBe('not_found');
  });

  it('missing user code → invalid_code error with status 400', async () => {
    // Empty form fails codeSchema (userCode min(1)) → the invalid_code branch.
    const outcome = await lookupDeviceCode(fakeProvider(), formData({}));

    expect(outcome.kind).toBe('error');
    expect(outcome.kind === 'error' && outcome.error).toBe('invalid_code');
    expect(outcome.kind === 'error' && outcome.status).toBe(400);

    const res = lookupOutcomeToResponse(outcome);
    expect(res instanceof Response && (res as Response).status === 302).toBe(false);
    const asData = res as { data?: { error?: string }; init?: { status?: number } };
    expect(asData.init?.status).toBe(400);
    expect(asData.data?.error).toBe('invalid_code');
  });
});

// ── /device/authorize loader → loadDeviceConsent (from authorize.test.ts) ─────────

describe('loadDeviceConsent (/device/authorize loader)', () => {
  it('builds requestId from the STABLE user code (device_<userCode>), not the device-auth id', async () => {
    // The real Zitadel adapter returns a different opaque id per getDeviceAuth call;
    // only the user code can be re-resolved when the login ceremony hands back.
    const req = new Request('http://localhost/id/device/authorize?user_code=WDJB-MJHT');
    const outcome = await loadDeviceConsent(fakeProvider(), req);
    expect(outcome.kind).toBe('consent');
    const consent = outcome.kind === 'consent' ? outcome.consent : null;
    expect(consent?.requestId).toBe('device_WDJB-MJHT');
    expect(consent?.deviceAuthId).toBe('dev-1');
  });

  it('missing user_code → 302 redirect to /device (contextless redirect half)', async () => {
    const req = new Request('http://localhost/id/device/authorize');
    const outcome = await loadDeviceConsent(fakeProvider(), req);

    // A contextless GET (no user_code) has nothing to recover — the service now returns
    // a `redirect` outcome to /device's code-entry screen instead of the 400 recovery error.
    // The route translates this to a 302; 302 ∈ url-resolution.cy.ts okStatuses, so the gate
    // follows it to /device's h1.
    expect(outcome.kind).toBe('redirect');
    const location = outcome.kind === 'redirect' ? outcome.location : null;
    expect(location).toBe('/device');
  });

  it('unknown user_code → recovery error; toResponse keeps the existing friendly 404', async () => {
    const req = new Request('http://localhost/id/device/authorize?user_code=NOPE');
    const outcome = await loadDeviceConsent(fakeProvider(), req);

    expect(outcome.kind).toBe('error');
    const error = outcome.kind === 'error' ? outcome.error : null;
    expect(error?.recovery).toBe('device');
    expect(error?.status).toBe(404);

    const res = deviceConsentErrorToResponse(error!);
    const asData = res as { init?: { status?: number } };
    expect(asData.init?.status).toBe(404);
  });
});

// ── /device/authorize action → resolveDeviceDecision (from authorize.test.ts) ──────

describe('resolveDeviceDecision (/device/authorize action)', () => {
  it('authorize with a session → device is authorized; redirects to the terminal /device/complete', async () => {
    const req = await requestWithSession('http://localhost/id/device/authorize');
    const outcome = await resolveDeviceDecision(
      fakeProvider(),
      req,
      // Use the dedicated dev-authorize id so this mutating test does not interfere
      // with dev-1 (used by the loader test for read-only resolution assertions).
      formData({
        decision: 'authorize',
        deviceAuthId: 'dev-authorize',
        requestId: 'device_dev-authorize',
      })
    );

    // Success is a 302 redirect to the TERMINAL completion screen carrying the decision —
    // authorizeDevice consumed the device-auth request, so re-rendering this route's loader
    // would NOT_FOUND; /device/complete has no getDeviceAuth loader.
    expect(outcome.kind).toBe('redirect');
    const location = outcome.kind === 'redirect' ? outcome.location : '';
    expect(location).toBe('/device/complete?decision=authorize');

    const res = decisionOutcomeToResponse(outcome) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/device/complete?decision=authorize');

    // The device should now be marked as authorized in the fake singleton.
    // dev-authorize is dedicated to this test — no other test mutates it.
    expect(fakeProvider().isDeviceAuthorized('dev-authorize')).toBe(true);
  });

  it('a dedicated authorize-only device id isolates state from other tests', async () => {
    // The isolation contract: the authorize test uses dev-authorize, NOT dev-1, so dev-1 remains
    // unauthorized even after the authorize test mutates the singleton. This test is
    // order-independent: it performs its own authorize on dev-authorize and then asserts dev-1
    // was untouched (proving the per-path isolation).
    const req = await requestWithSession('http://localhost/id/device/authorize');
    await resolveDeviceDecision(
      fakeProvider(),
      req,
      formData({
        decision: 'authorize',
        deviceAuthId: 'dev-authorize',
        requestId: 'device_dev-authorize',
      })
    );

    const fake = fakeProvider();
    // dev-authorize was authorized by THIS test — proof the path works.
    expect(fake.isDeviceAuthorized('dev-authorize')).toBe(true);
    // dev-1 must be unauthorized — this is the actual isolation assertion: the authorize action
    // on dev-authorize must not bleed into dev-1.
    expect(fake.isDeviceAuthorized('dev-1')).toBe(false);
  });

  it('deny → device stays unauthorized; redirects to the terminal /device/complete', async () => {
    const req = await requestWithSession('http://localhost/id/device/authorize');
    const outcome = await resolveDeviceDecision(
      fakeProvider(),
      req,
      formData({ decision: 'deny', deviceAuthId: 'dev-deny', requestId: 'device_dev-deny' })
    );

    // Deny also lands on the terminal completion screen, carrying decision=deny.
    expect(outcome.kind).toBe('redirect');
    const location = outcome.kind === 'redirect' ? outcome.location : '';
    expect(location).toBe('/device/complete?decision=deny');

    const res = decisionOutcomeToResponse(outcome) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/device/complete?decision=deny');

    // The device should NOT be authorized
    expect(fakeProvider().isDeviceAuthorized('dev-deny')).toBe(false);
  });

  it('authorize WITHOUT a session → redirect to /login with requestId', async () => {
    // No sessions cookie — unauthenticated user
    const req = new Request('http://localhost/id/device/authorize');
    const outcome = await resolveDeviceDecision(
      fakeProvider(),
      req,
      formData({ decision: 'authorize', deviceAuthId: 'dev-1', requestId: 'device_WDJB-MJHT' })
    );

    // Must be a 302 redirect to /login carrying the requestId
    expect(outcome.kind).toBe('redirect');
    const res = decisionOutcomeToResponse(outcome) as Response;
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('requestId=device_WDJB-MJHT');
  });
});
