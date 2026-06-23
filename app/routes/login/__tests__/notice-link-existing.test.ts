// @vitest-environment node
import { loader } from '@/routes/login/index';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/infra/env.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/infra/env.server')>();
  return { ...actual, env: { ...actual.env, AUTH_EMAIL_DELIVERY_ENABLED: true } };
});

const ORIGIN = 'http://localhost';

async function runLoader(search: string) {
  return loader({
    request: new Request(`${ORIGIN}/login${search}`),
    params: {},
    context: {} as never,
  } as never);
}

function bodyOf(res: unknown): Record<string, unknown> | null {
  if (res instanceof Response) return null;
  return (res as { data?: Record<string, unknown> }).data ?? null;
}

describe('login/index loader — notice passthrough', () => {
  it('threads notice=link-existing into loader data', async () => {
    const res = await runLoader('?loginName=you@gmail.com&notice=link-existing');
    expect(bodyOf(res)?.notice).toBe('link-existing');
  });

  it('omits notice when absent', async () => {
    const res = await runLoader('');
    expect(bodyOf(res)?.notice ?? null).toBeNull();
  });
});
