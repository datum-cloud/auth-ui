import {
  logAuthEvent,
  httpRequestDuration,
  registry,
  httpMetrics,
  hashActor,
  auditSink,
} from '../observability';
import { getTraceId, runWithTraceId } from '@/server/middleware/request-context';
import { describe, it, expect, vi } from 'vitest';

describe('hashActor', () => {
  it('is deterministic and 16 lowercase hex chars', () => {
    const h = hashActor('alice@example.com');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hashActor('alice@example.com')).toBe(h);
  });

  it('differs for different inputs and never echoes the input', () => {
    expect(hashActor('alice@example.com')).not.toBe(hashActor('bob@example.com'));
    expect(hashActor('alice@example.com')).not.toContain('alice');
  });

  it('returns empty string for empty input (no actor yet)', () => {
    expect(hashActor('')).toBe('');
  });
});

describe('logAuthEvent', () => {
  it('increments auth_events_total{event,outcome} and emits a kind:auth_event JSON line', async () => {
    const sink = vi.fn();
    logAuthEvent('password_check', 'success', { userId: 'u1' }, sink); // logger injected for determinism
    // metric incremented
    const dump = await registry.metrics();
    expect(dump).toContain('auth_events_total{event="password_check",outcome="success"}');
    // structured line emitted to the injected sink
    expect(sink).toHaveBeenCalledTimes(1);
    const line = JSON.parse(sink.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      kind: 'auth_event',
      event: 'password_check',
      outcome: 'success',
      userId: 'u1',
    });
  });

  it('includes traceId in JSON output when passed via fields (explicit override — backward-compat contract)', () => {
    // Verify the fields spread carries an explicit traceId through to the structured log
    // line.  This path also covers the ALS override: if a caller passes traceId in fields
    // it takes precedence over the ALS-sourced value (fields spread last).
    const sink = vi.fn();
    const traceId = '550e8400-e29b-41d4-a716-446655440000';
    logAuthEvent('password_check', 'success', { userId: 'u2', traceId }, sink);
    expect(sink).toHaveBeenCalledTimes(1);
    const line = JSON.parse(sink.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      kind: 'auth_event',
      event: 'password_check',
      outcome: 'success',
      userId: 'u2',
      traceId,
    });
  });
});

describe('logAuthEvent — AsyncLocalStorage traceId auto-injection', () => {
  // These tests exercise the ALS path: when logAuthEvent is called inside an als.run()
  // scope (as happens in real request handlers), the traceId is injected automatically
  // into the JSON log line without any call-site changes.

  it('emits the module-level ALS traceId automatically (no explicit fields)', () => {
    const sink = vi.fn();
    const traceId = 'als-real-00000000-0000-4000-a000-000000000002';
    runWithTraceId(traceId, () => {
      // NOTE: no traceId passed in fields — it must come from getTraceId()/the module ALS.
      logAuthEvent('mfa_verify', 'success', { userId: 'u7' }, sink);
    });
    const line = JSON.parse(sink.mock.calls[0][0] as string);
    expect(line.traceId).toBe(traceId);
  });

  it('omits traceId from JSON output when called outside an ALS context (unit-test / module-level code)', () => {
    // Outside a request context (e.g. in unit tests, startup code, or background tasks),
    // getTraceId() returns undefined and logAuthEvent must not emit a traceId key at all.
    const sink = vi.fn();
    // Call without any ALS store active and without passing traceId in fields.
    logAuthEvent('session_expired', 'failure', { userId: 'u3' }, sink);
    expect(sink).toHaveBeenCalledTimes(1);
    const line = JSON.parse(sink.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      kind: 'auth_event',
      event: 'session_expired',
      outcome: 'failure',
      userId: 'u3',
    });
    // Key must be absent — not present with value undefined (JSON.stringify omits undefined
    // values, but we verify the key is genuinely missing from the parsed object).
    expect(Object.prototype.hasOwnProperty.call(line, 'traceId')).toBe(false);
  });
});

describe('getTraceId — AsyncLocalStorage accessor', () => {
  it('returns undefined outside any ALS context', () => {
    // Verifies the accessor is safe to call from module-level or test code.
    expect(getTraceId()).toBeUndefined();
  });
});

describe('audit sink default', () => {
  it('exposes a single named default sink used by logAuthEvent', () => {
    expect(typeof auditSink).toBe('function');
  });
  it('logAuthEvent writes through the default sink when none is injected', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logAuthEvent('password_check', 'success', { userId: 'u9' }); // no explicit sink
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ kind: 'auth_event', event: 'password_check', userId: 'u9' });
    spy.mockRestore();
  });
});

describe('httpRequestDuration', () => {
  it('records an observation and exposes http_request_duration_seconds in the registry', async () => {
    const end = httpRequestDuration.startTimer();
    end({ method: 'GET', route: '/healthz', status_code: '200' });

    const dump = await registry.metrics();
    expect(dump).toContain('http_request_duration_seconds');
    expect(dump).toContain('method="GET"');
    expect(dump).toContain('route="/healthz"');
    expect(dump).toContain('status_code="200"');
  });
});

describe('httpMetrics middleware', () => {
  it('records the histogram even when the downstream handler throws (try/finally path)', async () => {
    const route = '/id/login/throw-test';
    // Minimal Hono-like context stub; routePath() is called inside the middleware
    // but throws itself if GET_MATCH_RESULT is absent — so we mock it too.
    const mockEnd = vi.fn();
    const startTimerSpy = vi.spyOn(httpRequestDuration, 'startTimer').mockReturnValue(mockEnd);

    const c = {
      req: {
        method: 'POST',
        path: route,
        // Stub the internal Hono symbol so routePath() returns the pattern.
        // If this stub is incomplete, the middleware falls back to c.req.path.
        routeIndex: 0,
      },
      res: undefined, // no response because the handler threw
    } as unknown as Parameters<typeof httpMetrics>[0];

    const next = vi.fn().mockRejectedValue(new Error('downstream boom'));

    await expect(httpMetrics(c, next)).rejects.toThrow('downstream boom');

    // Despite the throw, startTimer's returned `end` must have been called
    expect(mockEnd).toHaveBeenCalledTimes(1);
    const labels = mockEnd.mock.calls[0][0] as Record<string, string>;
    expect(labels.method).toBe('POST');
    // route is req.path fallback since the stub context lacks GET_MATCH_RESULT
    expect(labels.route).toBe(route);
    // status_code falls back to '500' when c.res is undefined
    expect(labels.status_code).toBe('500');

    startTimerSpy.mockRestore();
  });
});
