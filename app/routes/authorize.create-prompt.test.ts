import { loader } from './authorize';
import { describe, it, expect } from 'vitest';

describe('/authorize — create prompt', () => {
  it('redirects /authorize?prompt=create&requestId=oidc_x to /signup?requestId=oidc_x', async () => {
    // seed the fake provider with an auth request whose prompt is ['create']
    // (AUTH_PROVIDER=fake; authRequests: { x: { id: 'x', scopes: ['openid'], prompt: ['create'] } })
    const request = new Request('http://localhost/id/authorize?prompt=create&requestId=oidc_x');
    // `url` and `pattern` are required by RR7's LoaderFunctionArgs type; unused by this loader.
    const res = await loader({
      request,
      params: {},
      context: {} as never,
      url: new URL(request.url),
      pattern: '',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/signup');
    expect(location).toContain('requestId=oidc_x');
  });
});
