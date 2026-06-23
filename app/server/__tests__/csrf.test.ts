// app/server/__tests__/csrf.test.ts
// @vitest-environment node
//
// Must run in the node environment, not happy-dom: browsers (and happy-dom)
// enforce the Fetch spec rule that forbids setting the `Cookie` header on a
// Request object, so req.headers.get('cookie') always returns null in
// happy-dom — breaking the round-trip test. The node environment uses
// undici (the Node Fetch implementation), which does NOT strip Cookie.
//
// SESSION_SECRET is pinned in vitest.config.ts test.env:
//   SESSION_SECRET: 'test-secret-test-secret-32-chars!!'
//
// The CSRF implementation uses remix-utils/csrf/server (CSRF class).
// assertCsrf wraps csrf.validate() and catches ONLY CSRFError, rethrowing
// all others. That narrowing is verified by reading the source directly
// rather than by forcing a non-CSRFError at runtime (see test 5 below).
import { getCsrfToken, assertCsrf, assertCsrfWith } from '../csrf';
import { CSRFError } from 'remix-utils/csrf/server';
import { describe, it, expect } from 'vitest';

describe('getCsrfToken / assertCsrf', () => {
  // ── helpers ──────────────────────────────────────────────────────────────

  /** Build a Request that carries the csrf cookie from a prior commitToken. */
  function requestWithCookie(cookieHeader: string): Request {
    // Strip attributes (Path=, HttpOnly, …) — only the name=value pair matters.
    const cookieValue = cookieHeader.split(';')[0]; // e.g. "csrf=<token>"
    return new Request('http://localhost/id/login', {
      headers: { cookie: cookieValue },
    });
  }

  /** Build FormData carrying the given csrf field value (or nothing). */
  function formWithCsrf(token: string | null): FormData {
    const fd = new FormData();
    if (token !== null) fd.set('csrf', token);
    return fd;
  }

  // ── 1. Round-trip ─────────────────────────────────────────────────────────

  it('round-trip: getCsrfToken returns a non-empty token and a Set-Cookie header; assertCsrf resolves', async () => {
    const [token, cookieHeader] = await getCsrfToken(new Request('http://localhost/id/login'));

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    // getCsrfToken must emit a Set-Cookie header on the first call (no prior cookie).
    expect(cookieHeader).not.toBeNull();
    expect(cookieHeader).toMatch(/^csrf=/);

    // Build a request that already carries the cookie, plus FormData with the token.
    const req = requestWithCookie(cookieHeader as string);
    const fd = formWithCsrf(token);

    // Should resolve without throwing.
    await expect(assertCsrf(req, fd)).resolves.toBeUndefined();
  });

  // ── 2. Forged token → 403 ─────────────────────────────────────────────────

  it('forged token: same cookie but wrong csrf value in FormData → throws Response(403)', async () => {
    const [, cookieHeader] = await getCsrfToken(new Request('http://localhost/id/login'));

    const req = requestWithCookie(cookieHeader as string);
    const fd = formWithCsrf('forged-value');

    let thrown: unknown;
    try {
      await assertCsrf(req, fd);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });

  // ── 3. Missing token in FormData → 403 ────────────────────────────────────

  it('missing token: cookie present but no csrf field in FormData → throws Response(403)', async () => {
    const [, cookieHeader] = await getCsrfToken(new Request('http://localhost/id/login'));

    const req = requestWithCookie(cookieHeader as string);
    const fd = formWithCsrf(null); // no csrf field

    let thrown: unknown;
    try {
      await assertCsrf(req, fd);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });

  // ── 4. Missing cookie → 403 ───────────────────────────────────────────────

  it('missing cookie: FormData carries the token but request has no cookie header → throws Response(403)', async () => {
    const [token] = await getCsrfToken(new Request('http://localhost/id/login'));

    // No cookie header at all.
    const req = new Request('http://localhost/id/login');
    const fd = formWithCsrf(token);

    let thrown: unknown;
    try {
      await assertCsrf(req, fd);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });

  // ── 5. Non-CSRFError rethrow (code-level verification) ────────────────────
  //
  // It is impractical to force the underlying remix-utils CSRF machinery to
  // throw a non-CSRFError at runtime without monkey-patching internals.
  //
  // Instead, we verify the narrowing by reading the implementation:
  //
  //   catch (err) {
  //     if (err instanceof CSRFError) {
  //       throw new Response('Invalid CSRF token', { status: 403 });
  //     }
  //     throw err;   ← non-CSRFError rethrown unchanged
  //   }
  //
  // The `CSRFError` export from remix-utils/csrf/server is confirmed present
  // and re-exported here to ensure the import resolves at test time.

  it('non-CSRFError rethrow: CSRFError is the narrowing class used in assertCsrf (import verified)', () => {
    // Confirms the import resolves — if the class name or export path changes,
    // this test (and the implementation) will fail together.
    expect(typeof CSRFError).toBe('function');
    expect(new CSRFError('missing_token_in_cookie', 'test')).toBeInstanceOf(Error);
  });

  // ── 6. Non-CSRFError rethrow (runtime execution) ──────────────────────────
  //
  // The seam `assertCsrfWith` lets the test inject a verifier that throws a
  // plain Error (not a CSRFError). This exercises the `throw err` branch at
  // runtime so a regression that converts it to a 403 would be caught.

  it('rethrows a non-CSRFError unchanged (does not convert to 403)', async () => {
    const boom = new Error('not a csrf error');
    const req = new Request('http://localhost/id/login');
    const fd = new FormData();
    await expect(
      assertCsrfWith(req, fd, () => {
        throw boom;
      })
    ).rejects.toBe(boom);
  });
});
