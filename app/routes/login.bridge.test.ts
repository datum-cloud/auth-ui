// Bridge: Zitadel's login-v2 base URI lands the browser on /id/login?authRequest=…
// (or ?samlRequest=…). The loader must forward that raw protocol entry to the
// /authorize orchestrator; a plain /login (or the post-identifier ?requestId=
// return) must render normally and NOT redirect.
import { loader } from './login';
import { describe, it, expect } from 'vitest';

function req(search: string): Request {
  return new Request(`http://localhost/id/login${search}`);
}
async function run(search: string) {
  return loader({ request: req(search), params: {}, context: {} as never } as never);
}

describe('/login → /authorize protocol bridge', () => {
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
