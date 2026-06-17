// app/server/middleware/rate-limit.test.ts
import {
  RateLimiter,
  loginPasswordRateLimit,
  webauthnVerifyRateLimit,
  mfaEnrollRateLimit,
  accountsRateLimit,
  verifyEmailSendRateLimit,
} from './rate-limit';
import { Hono } from 'hono';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('RateLimiter (pure, injected clock)', () => {
  it('allows up to the limit, then blocks within the window', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    const k = 'ip|alice';
    expect(rl.check(k, 0).allowed).toBe(true);
    expect(rl.check(k, 10).allowed).toBe(true);
    expect(rl.check(k, 20).allowed).toBe(true);
    const fourth = rl.check(k, 30);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });
  it('resets after the window elapses', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.check('k', 0).allowed).toBe(true);
    expect(rl.check('k', 500).allowed).toBe(false);
    expect(rl.check('k', 1500).allowed).toBe(true);
  });
  it('isolates keys', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.check('a', 0).allowed).toBe(true);
    expect(rl.check('b', 0).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Middleware-level tests: drive loginPasswordRateLimit via a minimal Hono app.
// Date.now() is spied deterministically so these tests are stable.
// ---------------------------------------------------------------------------
function buildApp() {
  const app = new Hono();
  app.use('/id/login/*', loginPasswordRateLimit);
  // Register both canonical and trailing-slash variants so the stub reaches the middleware
  // even when Hono's strict path matching would otherwise 404 the trailing-slash form.
  app.all('/id/login/password', (c) => c.json({ ok: true }, 200));
  app.all('/id/login/password/', (c) => c.json({ ok: true }, 200));
  app.all('/id/login/other', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('loginPasswordRateLimit middleware', () => {
  let app: ReturnType<typeof buildApp>;
  let nowMs: number;

  beforeEach(() => {
    // Each test gets a fresh Hono app (fresh module-level limiter state).
    // We re-import to get a fresh passwordLimiter instance, but since it is
    // module-level we pin Date.now() to a fixed base and advance it per call.
    // vitest restoreMocks is true globally, so the spy resets after each test.
    nowMs = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    app = buildApp();
  });

  it('(a) POST is blocked with 429 + Retry-After after 5 attempts', async () => {
    const ip = '10.0.0.1';
    const url = 'http://app/id/login/password?loginName=alice';
    const makeReq = () =>
      new Request(url, { method: 'POST', headers: { 'x-forwarded-for': `1.2.3.4, ${ip}` } });

    for (let i = 0; i < 5; i++) {
      nowMs += 100;
      const res = await app.request(makeReq());
      expect(res.status, `attempt ${i + 1} should be 200`).toBe(200);
    }
    nowMs += 100;
    const blocked = await app.request(makeReq());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('(b) GET does NOT consume the budget', async () => {
    const ip = '10.0.0.2';
    const url = 'http://app/id/login/password?loginName=bob';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    // Exhaust with GETs — should never count.
    for (let i = 0; i < 10; i++) {
      nowMs += 50;
      const res = await app.request(new Request(url, { method: 'GET', headers }));
      expect(res.status).toBe(200);
    }
    // A POST should still be allowed (budget not consumed by GETs).
    nowMs += 50;
    const res = await app.request(new Request(url, { method: 'POST', headers }));
    expect(res.status).toBe(200);
  });

  it('(c) trailing-slash POST variant IS limited (same budget as canonical path)', async () => {
    const ip = '10.0.0.3';
    const canonical = 'http://app/id/login/password?loginName=carol';
    const withSlash = 'http://app/id/login/password/?loginName=carol';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    // Use 4 attempts on the canonical path.
    for (let i = 0; i < 4; i++) {
      nowMs += 100;
      await app.request(new Request(canonical, { method: 'POST', headers }));
    }
    // 5th attempt on the trailing-slash variant should consume the last slot.
    nowMs += 100;
    const fifth = await app.request(new Request(withSlash, { method: 'POST', headers }));
    expect(fifth.status).toBe(200);

    // 6th attempt (either path) must be blocked.
    nowMs += 100;
    const sixth = await app.request(new Request(withSlash, { method: 'POST', headers }));
    expect(sixth.status).toBe(429);
  });

  it('(d) XFF hop-0 rotation does NOT mint fresh buckets when last hop is fixed', async () => {
    const trustedIp = '10.0.0.4';
    const url = 'http://app/id/login/password?loginName=dave';

    // Use 5 attempts with a fixed last hop but rotating hop-0 (attacker-controlled).
    for (let i = 0; i < 5; i++) {
      nowMs += 100;
      const spoofedXff = `192.168.${i}.${i}, ${trustedIp}`;
      const res = await app.request(
        new Request(url, { method: 'POST', headers: { 'x-forwarded-for': spoofedXff } })
      );
      expect(res.status, `attempt ${i + 1} should pass`).toBe(200);
    }
    // 6th attempt: despite a new hop-0, the last hop is still trustedIp → blocked.
    nowMs += 100;
    const blocked = await app.request(
      new Request(url, {
        method: 'POST',
        headers: { 'x-forwarded-for': `99.99.99.99, ${trustedIp}` },
      })
    );
    expect(blocked.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// webauthnVerifyRateLimit — covers POST /id/login/passkey, /id/login/security-key,
// /id/login/mfa (10 per 5 min, ip-only).
// ---------------------------------------------------------------------------
function buildWebauthnApp() {
  const app = new Hono();
  app.use('/id/login/*', webauthnVerifyRateLimit);
  app.all('/id/login/passkey', (c) => c.json({ ok: true }, 200));
  app.all('/id/login/passkey/', (c) => c.json({ ok: true }, 200));
  app.all('/id/login/security-key', (c) => c.json({ ok: true }, 200));
  app.all('/id/login/mfa', (c) => c.json({ ok: true }, 200));
  // Unguarded sibling — must pass through without consuming the budget.
  app.all('/id/login/password', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('webauthnVerifyRateLimit middleware', () => {
  let app: ReturnType<typeof buildWebauthnApp>;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 2_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    app = buildWebauthnApp();
  });

  it('(a) POST /id/login/passkey is blocked after 10 attempts', async () => {
    const ip = '10.1.0.1';
    const url = 'http://app/id/login/passkey';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 10; i++) {
      nowMs += 100;
      const res = await app.request(new Request(url, { method: 'POST', headers }));
      expect(res.status, `attempt ${i + 1} should be 200`).toBe(200);
    }
    nowMs += 100;
    const blocked = await app.request(new Request(url, { method: 'POST', headers }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('(b) POST /id/login/security-key and /id/login/mfa share the same ip bucket', async () => {
    const ip = '10.1.0.2';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    // 5 attempts on /security-key + 5 on /mfa = 10 total → next (11th) blocked.
    for (let i = 0; i < 5; i++) {
      nowMs += 100;
      await app.request(
        new Request('http://app/id/login/security-key', { method: 'POST', headers })
      );
    }
    for (let i = 0; i < 5; i++) {
      nowMs += 100;
      await app.request(new Request('http://app/id/login/mfa', { method: 'POST', headers }));
    }
    nowMs += 100;
    const blocked = await app.request(
      new Request('http://app/id/login/passkey', { method: 'POST', headers })
    );
    expect(blocked.status).toBe(429);
  });

  it('(c) POST /id/login/password does NOT consume the webauthn budget', async () => {
    const ip = '10.1.0.3';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    // 10 POSTs to /login/password — webauthnVerifyRateLimit self-guards, must pass through.
    for (let i = 0; i < 10; i++) {
      nowMs += 100;
      const res = await app.request(
        new Request('http://app/id/login/password', { method: 'POST', headers })
      );
      expect(res.status).toBe(200);
    }
    // A POST to /login/passkey should still be allowed (budget not consumed).
    nowMs += 100;
    const res = await app.request(
      new Request('http://app/id/login/passkey', { method: 'POST', headers })
    );
    expect(res.status).toBe(200);
  });

  it('(d) GET does NOT consume the budget', async () => {
    const ip = '10.1.0.4';
    const url = 'http://app/id/login/passkey';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 12; i++) {
      nowMs += 50;
      const res = await app.request(new Request(url, { method: 'GET', headers }));
      expect(res.status).toBe(200);
    }
    // Budget must be untouched — POST should still be allowed.
    nowMs += 50;
    const res = await app.request(new Request(url, { method: 'POST', headers }));
    expect(res.status).toBe(200);
  });

  it('(e) trailing-slash POST variant is limited (same bucket)', async () => {
    const ip = '10.1.0.5';
    const url = 'http://app/id/login/passkey';
    const withSlash = 'http://app/id/login/passkey/';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 10; i++) {
      nowMs += 100;
      await app.request(new Request(url, { method: 'POST', headers }));
    }
    nowMs += 100;
    const blocked = await app.request(new Request(withSlash, { method: 'POST', headers }));
    expect(blocked.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// mfaEnrollRateLimit — covers all POST /id/setup/* enrollment routes
// (15 per 5 min, ip-only).
// ---------------------------------------------------------------------------
function buildEnrollApp() {
  const app = new Hono();
  app.use('/id/setup/*', mfaEnrollRateLimit);
  app.all('/id/setup/passkey', (c) => c.json({ ok: true }, 200));
  app.all('/id/setup/security-key', (c) => c.json({ ok: true }, 200));
  app.all('/id/setup/authenticator', (c) => c.json({ ok: true }, 200));
  app.all('/id/setup/email', (c) => c.json({ ok: true }, 200));
  app.all('/id/setup/sms', (c) => c.json({ ok: true }, 200));
  app.all('/id/setup/mfa', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('mfaEnrollRateLimit middleware', () => {
  let app: ReturnType<typeof buildEnrollApp>;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 3_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    app = buildEnrollApp();
  });

  it('(a) POST /id/setup/passkey is blocked after 15 attempts', async () => {
    const ip = '10.2.0.1';
    const url = 'http://app/id/setup/passkey';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 15; i++) {
      nowMs += 100;
      const res = await app.request(new Request(url, { method: 'POST', headers }));
      expect(res.status, `attempt ${i + 1} should be 200`).toBe(200);
    }
    nowMs += 100;
    const blocked = await app.request(new Request(url, { method: 'POST', headers }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('(b) attempts spread across multiple /setup/* paths share the same ip bucket', async () => {
    const ip = '10.2.0.2';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };
    const paths = [
      'http://app/id/setup/passkey',
      'http://app/id/setup/security-key',
      'http://app/id/setup/authenticator',
      'http://app/id/setup/email',
      'http://app/id/setup/sms',
    ];

    // 3 attempts on each of the 5 paths = 15 total → next (16th) blocked.
    for (const url of paths) {
      for (let i = 0; i < 3; i++) {
        nowMs += 100;
        await app.request(new Request(url, { method: 'POST', headers }));
      }
    }
    nowMs += 100;
    const blocked = await app.request(
      new Request('http://app/id/setup/mfa', { method: 'POST', headers })
    );
    expect(blocked.status).toBe(429);
  });

  it('(c) GET does NOT consume the budget', async () => {
    const ip = '10.2.0.3';
    const url = 'http://app/id/setup/passkey';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 20; i++) {
      nowMs += 50;
      const res = await app.request(new Request(url, { method: 'GET', headers }));
      expect(res.status).toBe(200);
    }
    nowMs += 50;
    const res = await app.request(new Request(url, { method: 'POST', headers }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// accountsRateLimit — covers POST /id/accounts (switch/remove; 15 per 5 min, ip-only).
// ---------------------------------------------------------------------------
function buildAccountsApp() {
  const app = new Hono();
  app.use('/id/accounts', accountsRateLimit);
  app.all('/id/accounts', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('accountsRateLimit middleware', () => {
  let app: ReturnType<typeof buildAccountsApp>;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 4_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    app = buildAccountsApp();
  });

  it('(a) POST /id/accounts is blocked after 15 attempts', async () => {
    const ip = '10.3.0.1';
    const url = 'http://app/id/accounts';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 15; i++) {
      nowMs += 100;
      const res = await app.request(new Request(url, { method: 'POST', headers }));
      expect(res.status, `attempt ${i + 1} should be 200`).toBe(200);
    }
    nowMs += 100;
    const blocked = await app.request(new Request(url, { method: 'POST', headers }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('(b) GET does NOT consume the budget', async () => {
    const ip = '10.3.0.2';
    const url = 'http://app/id/accounts';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 20; i++) {
      nowMs += 50;
      const res = await app.request(new Request(url, { method: 'GET', headers }));
      expect(res.status).toBe(200);
    }
    nowMs += 50;
    const res = await app.request(new Request(url, { method: 'POST', headers }));
    expect(res.status).toBe(200);
  });

  it('(c) different IPs use isolated buckets — one exhausted IP does not block another', async () => {
    const ipA = '10.3.0.3';
    const ipB = '10.3.0.4';
    const url = 'http://app/id/accounts';

    // Exhaust ipA's budget.
    for (let i = 0; i < 15; i++) {
      nowMs += 100;
      await app.request(
        new Request(url, {
          method: 'POST',
          headers: { 'x-forwarded-for': `1.2.3.4, ${ipA}` },
        })
      );
    }
    nowMs += 100;
    const blockedA = await app.request(
      new Request(url, { method: 'POST', headers: { 'x-forwarded-for': `1.2.3.4, ${ipA}` } })
    );
    expect(blockedA.status).toBe(429);

    // ipB should still be allowed (isolated bucket).
    nowMs += 100;
    const allowedB = await app.request(
      new Request(url, { method: 'POST', headers: { 'x-forwarded-for': `1.2.3.4, ${ipB}` } })
    );
    expect(allowedB.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// verifyEmailSendRateLimit — covers GET /id/verify?send=true (CODE-MAJ-08).
// ---------------------------------------------------------------------------
function buildVerifyApp() {
  const app = new Hono();
  app.use('/id/verify', verifyEmailSendRateLimit);
  app.all('/id/verify', (c) => c.json({ ok: true }, 200));
  return app;
}

describe('verifyEmailSendRateLimit middleware (CODE-MAJ-08)', () => {
  let app: ReturnType<typeof buildVerifyApp>;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    app = buildVerifyApp();
  });

  it('(a) GET ?send=true is blocked with 429 after 10 attempts', async () => {
    const ip = '10.4.0.1';
    const url = 'http://app/id/verify?send=true';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 10; i++) {
      nowMs += 100;
      const res = await app.request(new Request(url, { method: 'GET', headers }));
      expect(res.status, `attempt ${i + 1} should be 200`).toBe(200);
    }
    nowMs += 100;
    const blocked = await app.request(new Request(url, { method: 'GET', headers }));
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('RATE_LIMITED');
  });

  it('(b) GET without ?send=true does NOT consume the budget', async () => {
    const ip = '10.4.0.2';
    const url = 'http://app/id/verify';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 15; i++) {
      nowMs += 50;
      const res = await app.request(new Request(url, { method: 'GET', headers }));
      expect(res.status).toBe(200);
    }
    // A ?send=true from the same IP should still be allowed (budget unspent).
    nowMs += 50;
    const res = await app.request(new Request(`${url}?send=true`, { method: 'GET', headers }));
    expect(res.status).toBe(200);
  });

  it('(c) POST is never rate-limited by this middleware', async () => {
    const ip = '10.4.0.3';
    const url = 'http://app/id/verify?send=true';
    const headers = { 'x-forwarded-for': `1.2.3.4, ${ip}` };

    for (let i = 0; i < 15; i++) {
      nowMs += 50;
      const res = await app.request(new Request(url, { method: 'POST', headers }));
      expect(res.status).toBe(200);
    }
  });
});
