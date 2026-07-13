import { getAuthProvider } from '@/modules/auth/select.server';
import { resolveAuthorize, outcomeToResponse } from '@/resources/authorize';

async function run(search: string) {
  const provider = getAuthProvider({ AUTH_PROVIDER: 'fake' });
  const request = new Request(`http://localhost/id/authorize${search}`);
  const outcome = await resolveAuthorize(provider, request);
  return outcomeToResponse(outcome, new URL(request.url));
}

describe('/authorize device_ branch', () => {
  it('redirects a device_<userCode> requestId back to the consent screen', async () => {
    const res = await run('?requestId=device_WDJB-MJHT');
    expect(res.status).to.equal(302);
    expect(res.headers.get('location') ?? '').to.include('/device/authorize?user_code=WDJB-MJHT');
  });
});
