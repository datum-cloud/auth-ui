// Post-login return-to-consent for device grants: a device_<userCode> requestId
// arriving at /authorize (threaded back by the login ceremony) must hand control
// back to /device/authorize so consent can complete. Verified against real Zitadel
// 2026-06-13: getDeviceAuth returns a DIFFERENT opaque id on every call, so the
// stable user code — not the device-auth id — is the only re-resolvable handle.
import { loader } from './authorize';
import { describe, it, expect } from 'vitest';

async function run(search: string) {
  const request = new Request(`http://localhost/id/authorize${search}`);
  return loader({ request, params: {}, context: {} as never } as never);
}

describe('/authorize device_ branch', () => {
  it('redirects a device_<userCode> requestId back to the consent screen', async () => {
    const res = (await run('?requestId=device_WDJB-MJHT')) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/device/authorize?user_code=WDJB-MJHT');
  });

  it('redirects even when a sessionId is threaded (post-password hand-back)', async () => {
    const res = (await run('?requestId=device_WDJB-MJHT&sessionId=s1')) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('/device/authorize?user_code=WDJB-MJHT');
  });

  it('redirects with an empty user_code when requestId is bare device_ prefix (downstream loader 400s)', async () => {
    // GET /authorize?requestId=device_ — the prefix is valid so the guard passes,
    // userCode = "" after slice, loader emits 302 to /device/authorize?user_code=
    // (the consent loader rejects the empty code with a 400; verified in device.authorize tests).
    const res = (await run('?requestId=device_')) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toBe('/device/authorize?user_code=');
  });
});
