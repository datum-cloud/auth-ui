// app/routes/verify.test.ts
// TDD tests for the session-ownership gate on the ?send=true email-code dispatch path.
// CODE-MAJ-08: the loader previously sent an email code for ANY userId on an unauthenticated
// GET — a code-flood / enumeration vector. The fix gates the send on an active session whose
// resolved user matches the userId query param.
//
// @vitest-environment node
//
// node env: happy-dom forbids setting the `Cookie` header on a Request.
import { loader } from './verify';
import { FakeAuthProvider } from '@/providers/fake/fake-provider';
import { getAuthProvider } from '@/providers/select.server';
import { sessionsCookie } from '@/session/cookie';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/env.server')>();
  return {
    ...actual,
    env: { ...actual.env, PUBLIC_ORIGIN: 'https://auth.datum.net', SESSION_SECRET: 'test-secret' },
  };
});

const BASE = 'http://localhost/id/verify';

interface RunVerifyOpts {
  url?: string;
  /** If provided, a sessions cookie carrying this entry will be attached. */
  session?: { id: string; token: string; userId: string };
  /** Override the provider's sendEmailCode to spy on calls. */
  sendEmailCode?: () => Promise<void>;
}

async function runVerifyLoader({ url = BASE, session, sendEmailCode }: RunVerifyOpts) {
  const fake = getAuthProvider({ AUTH_PROVIDER: 'fake' }) as FakeAuthProvider;

  if (session) {
    // Seed a live session with the given id/token so getSession returns a Session with user.id.
    fake.seedLiveSession({
      id: session.id,
      token: session.token,
      user: { id: session.userId, loginName: 'test@example.com' },
    });
  }

  if (sendEmailCode) {
    vi.spyOn(fake, 'sendEmailCode').mockImplementation(sendEmailCode);
  }

  const headers: Record<string, string> = {};
  if (session) {
    const cookieStr = await sessionsCookie.serialize([
      {
        id: session.id,
        token: session.token,
        loginName: 'test@example.com',
        creationTs: '2026-01-01T00:00:00.000Z',
        expirationTs: '2099-01-01T00:00:00.000Z',
        changeTs: '2026-01-01T00:00:00.000Z',
      },
    ]);
    headers['cookie'] = cookieStr.split(';')[0];
  }

  const request = new Request(url, { headers });
  return loader({ request, params: {}, context: {} as never } as never);
}

describe('verify loader — session-ownership gate on ?send=true (CODE-MAJ-08)', () => {
  it('does not send an email code when the session user does not match the userId query', async () => {
    let sent = 0;
    await runVerifyLoader({
      url: `${BASE}?send=true&userId=victim-999`,
      session: { id: 's1', token: 't1', userId: 'attacker-1' },
      sendEmailCode: () => {
        sent++;
        return Promise.resolve();
      },
    });
    expect(sent).toBe(0);
  });

  it('sends an email code when the session user matches the userId query', async () => {
    let sent = 0;
    await runVerifyLoader({
      url: `${BASE}?send=true&userId=self-1`,
      session: { id: 's1', token: 't1', userId: 'self-1' },
      sendEmailCode: () => {
        sent++;
        return Promise.resolve();
      },
    });
    expect(sent).toBe(1);
  });
});
