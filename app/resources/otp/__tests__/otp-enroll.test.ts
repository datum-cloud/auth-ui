// app/routes/_shared/otp-enroll.test.ts
// @vitest-environment node
import { createOtpEnrollHandlers } from '../otp-enroll';
import { sessionsCookie } from '@/modules/auth/session/cookie';
import { describe, it, expect } from 'vitest';

const { loader } = createOtpEnrollHandlers({
  enroll: async () => {},
  factor: 'otp_email',
  verifyPath: '/login/verify/email',
});

async function cookieFor(loginName: string) {
  const entry = {
    id: 's1',
    token: 't1',
    loginName,
    creationTs: '2026-01-01T00:00:00.000Z',
    expirationTs: '2099-01-01T00:00:00.000Z',
    changeTs: '2026-01-01T00:00:00.000Z',
  };
  return (await sessionsCookie.serialize([entry])).split(';')[0];
}

describe('otp-enroll loader', () => {
  it('does not throw on a tampered force= query param', async () => {
    const cookie = await cookieFor('alice@acme.test');
    const req = new Request(
      'http://localhost/id/setup/email?loginName=alice%40acme.test&force=garbage',
      { headers: { cookie } }
    );
    const res = await loader({ request: req, params: {}, context: {} as never } as never);
    const asData = res as { data?: { force?: unknown } };
    // graceful: invalid optional enum coerced to undefined, no 500.
    expect(asData.data?.force).toBeUndefined();
  });
});
