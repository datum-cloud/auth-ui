// @vitest-environment happy-dom
import type { AppLoadContext, EntryContext } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bug D regression guard: RR7 nonces its own streamed loader-data scripts
// (window.__reactRouterContext.streamController.enqueue/close) using the `nonce`
// prop on <ServerRouter>. If that prop is missing, those inline scripts ship
// WITHOUT a nonce, the prod CSP ('script-src 'self' 'nonce-…' 'strict-dynamic'')
// blocks them, the hydration data stream never closes, and hydration stalls
// app-wide. This test asserts handleRequest forwards loadContext.cspNonce as the
// ServerRouter nonce prop — the single source of the nonce on those scripts.

const serverRouterSpy = vi.fn();

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    // Replace ServerRouter with a spy that records its props and renders a
    // trivial host element so renderToPipeableStream's shell resolves.
    ServerRouter: (props: Record<string, unknown>) => {
      serverRouterSpy(props);
      return <div id="server-router-stub" />;
    },
  };
});

// Sentry init is a no-op without SENTRY_DSN but keep the import side effects out.
vi.mock('@/server/sentry.server', () => ({
  captureException: vi.fn(),
}));

const CSP_NONCE = 'test-nonce-abc123';

function makeEntryContext(): EntryContext {
  // ServerRouter is stubbed, so the real EntryContext shape is never consumed.
  return {} as unknown as EntryContext;
}

function makeLoadContext(nonce: string | undefined): AppLoadContext {
  return { cspNonce: nonce } as unknown as AppLoadContext;
}

async function invokeHandleRequest(loadContext: AppLoadContext): Promise<Response> {
  const { default: handleRequest } = await import('../entry.server');
  const request = new Request('https://auth.localtest.me/id/login');
  return handleRequest(request, 200, new Headers(), makeEntryContext(), loadContext);
}

describe('entry.server handleRequest — CSP nonce on ServerRouter (Bug D)', () => {
  beforeEach(() => {
    serverRouterSpy.mockClear();
  });

  it('passes loadContext.cspNonce as the ServerRouter nonce prop', async () => {
    const response = await invokeHandleRequest(makeLoadContext(CSP_NONCE));
    // Drain the stream so the render fully completes.
    await response.text();

    expect(serverRouterSpy).toHaveBeenCalledTimes(1);
    const props = serverRouterSpy.mock.calls[0][0] as { nonce?: unknown };
    expect(props.nonce).toBe(CSP_NONCE);
  });

  it('forwards an undefined nonce in dev (no cspNonce on loadContext)', async () => {
    const response = await invokeHandleRequest(makeLoadContext(undefined));
    await response.text();

    expect(serverRouterSpy).toHaveBeenCalledTimes(1);
    const props = serverRouterSpy.mock.calls[0][0] as { nonce?: unknown };
    expect(props.nonce).toBeUndefined();
  });
});
