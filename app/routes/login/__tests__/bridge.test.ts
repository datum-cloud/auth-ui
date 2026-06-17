// Route-level wiring: the bridge DECISION (shouldBridgeToAuthorize) is unit-tested at
// the service level in app/resources/login/__tests__/bridge.test.ts. This thin test
// keeps the route-level redirect WIRING assertions — that the loader turns a bridge
// decision into a real 302 to /authorize preserving the query, and renders (no 302)
// otherwise.
import { loader } from '@/routes/login/index';
import { describe, it, expect } from 'vitest';

function req(search: string): Request {
  return new Request(`http://localhost/id/login${search}`);
}
async function run(search: string) {
  return loader({ request: req(search), params: {}, context: {} as never } as never);
}

describe('/login loader → /authorize redirect wiring', () => {
  it('forwards ?authRequest= to /authorize, preserving the query', async () => {
    const res = (await run('?authRequest=V2_abc&organization=org1')) as Response;
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/authorize');
    expect(loc).toContain('authRequest=V2_abc');
    expect(loc).toContain('organization=org1');
  });

  it('forwards ?samlRequest= to /authorize', async () => {
    const res = (await run('?samlRequest=sr-1')) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/authorize?samlRequest=sr-1');
  });

  it('does NOT redirect a plain /login (renders the identifier screen)', async () => {
    const res = (await run('')) as Response;
    // loader returns a data() response (200-ish), never a 302 to /authorize
    const loc = res.headers?.get?.('location') ?? '';
    expect(loc).not.toContain('/authorize');
  });

  it('does NOT re-trigger on the post-identifier ?requestId= return (no loop)', async () => {
    const res = (await run('?requestId=oidc_V2_abc')) as Response;
    const loc = res.headers?.get?.('location') ?? '';
    expect(loc).not.toContain('/authorize');
  });
});
