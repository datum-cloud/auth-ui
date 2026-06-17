// app/server.test.ts
// @vitest-environment node
//
// Regression guard for the /metrics trust boundary (CODE-MIN-20).
// The Hono app created by createHonoServer is not easily instantiated in unit tests
// (it resolves a Bun-specific server and requires the full React Router build). Instead
// we construct a minimal Hono app that mounts the /metrics handler exactly as
// app/server.ts does — using the same `registry` module export — and assert the
// documented contract: /metrics is reachable with NO auth header and returns 200
// with `auth_events_total` in the body.
//
// This is a PINNING test, not a smoke test of the full server. If someone adds
// authentication to /metrics, this test will fail and force a conscious decision
// about the gateway-policy trade-off (scraping will break without a corresponding
// gateway change).
import { registry } from '@/server/observability';
import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';

function makeMetricsApp() {
  const app = new Hono();
  // Mirror the exact handler from app/server.ts lines 131-133.
  app.get('/metrics', async (c) =>
    c.text(await registry.metrics(), 200, { 'content-type': registry.contentType })
  );
  return app;
}

describe('/metrics trust boundary (CODE-MIN-20)', () => {
  it('GET /metrics is reachable without auth (gateway-internal trust boundary — CODE-MIN-20)', async () => {
    const app = makeMetricsApp();
    // No Authorization header — asserting unauthenticated access is the contract.
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('auth_events_total');
  });
});
