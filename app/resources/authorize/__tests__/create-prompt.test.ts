// Pass 2 service test (migrated from routes/authorize/__tests__/create-prompt.test.ts).
// The former route loader logic now lives in resolveAuthorize; the route is a thin
// translator. We drive the service directly against the fake provider singleton and
// assert on the Response produced by outcomeToResponse — identical to what the route
// returns — so the original create-prompt assertions are preserved verbatim.
import { getAuthProvider } from '@/modules/auth/select.server';
import { resolveAuthorize, outcomeToResponse } from '@/resources/authorize';
import { describe, it, expect } from 'vitest';

describe('/authorize — create prompt', () => {
  it('redirects /authorize?prompt=create&requestId=oidc_x to /signup?requestId=oidc_x', async () => {
    // seed the fake provider with an auth request whose prompt is ['create']
    // (AUTH_PROVIDER=fake; authRequests: { x: { id: 'x', scopes: ['openid'], prompt: ['create'] } })
    const provider = getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const request = new Request('http://localhost/id/authorize?prompt=create&requestId=oidc_x');
    const outcome = await resolveAuthorize(provider, request);
    const res = outcomeToResponse(outcome, new URL(request.url));
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/signup');
    expect(location).toContain('requestId=oidc_x');
  });
});
