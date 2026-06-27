import { getAuthProvider } from '@/modules/auth/select.server';
import { resolveAuthorize, outcomeToResponse } from '@/resources/authorize';

describe('/authorize — create prompt', () => {
  it('redirects /authorize?prompt=create&requestId=oidc_x to /signup?requestId=oidc_x', async () => {
    const provider = getAuthProvider({ AUTH_PROVIDER: 'fake' });
    const request = new Request('http://localhost/id/authorize?prompt=create&requestId=oidc_x');
    const outcome = await resolveAuthorize(provider, request);
    const res = outcomeToResponse(outcome, new URL(request.url));
    expect(res.status).to.equal(302);
    const location = res.headers.get('location') ?? '';
    expect(location).to.include('/signup');
    expect(location).to.include('requestId=oidc_x');
  });
});
