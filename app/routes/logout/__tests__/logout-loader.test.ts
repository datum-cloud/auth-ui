import { loader } from '@/routes/logout/index';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { completeOidcLogout } = vi.hoisted(() => ({
  completeOidcLogout: vi.fn(async () => ({
    location: '/logout/success',
    setCookie: 'sessions=; Path=/id',
  })),
}));

vi.mock('@/server/auth-context.server', () => ({
  providerForRequest: () => ({ deleteSession: vi.fn(async () => undefined) }),
}));
vi.mock('@/server/csrf', () => ({
  loaderCsrf: vi.fn(async () => ({ csrfToken: 'csrf-abc', headers: {} })),
  assertCsrf: vi.fn(),
}));
vi.mock('@/resources/session', async (orig) => ({
  ...(await orig<typeof import('@/resources/session')>()),
  completeOidcLogout,
  logoutOutcomeToResponse: (o: { location: string; setCookie: string }) =>
    new Response(null, {
      status: 302,
      headers: { location: o.location, 'set-cookie': o.setCookie },
    }),
}));

describe('logout loader', () => {
  beforeEach(() => {
    completeOidcLogout.mockClear();
  });

  it('logout_token present → completes OIDC logout (302), does not render confirm', async () => {
    const request = new Request(
      'https://auth.localtest.me:30000/id/logout?logout_token=jwt&post_logout_redirect=/logout/done'
    );
    const res = await loader({ request, params: {}, context: {} as never } as never);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect(completeOidcLogout).toHaveBeenCalledOnce();
  });

  it('no logout_token → returns csrf payload for the confirm page', async () => {
    const request = new Request('https://auth.localtest.me:30000/id/logout');
    const res = await loader({ request, params: {}, context: {} as never } as never);
    expect(completeOidcLogout).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toContain('csrf-abc');
  });
});
