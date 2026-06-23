import { scrubEvent } from '../sentry-scrub';
import type { AppErrorCode } from '@/shared/errors/app-error';
import type { ErrorEvent, Event } from '@sentry/react-router';
import { describe, expect, it } from 'vitest';

// Strict egress neutrality. The Sentry `beforeSend` scrubber is an
// ALLOWLIST: it emits ONLY the fields explicitly known to be safe and DROPS
// everything else. These tests feed a hostile synthetic event carrying every
// class of forbidden data — a loginName/identifier, a raw provider proto string,
// and a token-bearing URL — and assert NONE of them survive while the
// allowlisted fields DO.

// Sentinels: if any of these strings appear ANYWHERE in the serialized scrubbed
// event, the scrubber leaked.
const LOGIN_NAME = 'alice@victim.example.com';
const USER_ID = 'user-9f3c-secret';
const PROVIDER_PROTO = 'zitadel.session.v2.CheckPassword: PERMISSION_DENIED (grpc code 7)';
const ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.PAYLOAD.SIGNATURE';
const TOKEN_URL = `https://auth.localtest.me/id/login?access_token=${ACCESS_TOKEN}&loginName=${LOGIN_NAME}`;
const COOKIE = `__session=${ACCESS_TOKEN}; csrf=deadbeef`;

const APP_CODE: AppErrorCode = 'INVALID_CREDENTIALS';
const TRACE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SPAN_ID = '0011223344556677';

/** A maximally hostile error event: every forbidden field is populated. */
function hostileEvent(): ErrorEvent {
  return {
    type: undefined,
    event_id: 'ev-1234',
    timestamp: 1_700_000_000,
    level: 'error',
    platform: 'node',
    release: 'auth-ui@1.2.3',
    environment: 'production',
    // Exception value carries the raw provider/proto detail — must be reduced to the code.
    exception: {
      values: [
        {
          type: 'ProviderError',
          value: PROVIDER_PROTO,
          mechanism: { handled: true, type: 'generic' },
          stacktrace: {
            frames: [
              // A stack frame whose vars leak the loginName + token.
              {
                filename: '/app/auth.ts',
                function: 'checkPassword',
                vars: { loginName: LOGIN_NAME, token: ACCESS_TOKEN },
              },
            ],
          },
        },
      ],
    },
    // PII / identifiers — must be dropped entirely.
    user: { id: USER_ID, email: LOGIN_NAME, username: LOGIN_NAME, ip_address: '203.0.113.7' },
    // Token-bearing URL + cookies + headers + body — must be dropped (beyond a safe subset).
    request: {
      url: TOKEN_URL,
      method: 'POST',
      query_string: `access_token=${ACCESS_TOKEN}&loginName=${LOGIN_NAME}`,
      cookies: { __session: ACCESS_TOKEN },
      headers: {
        cookie: COOKIE,
        authorization: `Bearer ${ACCESS_TOKEN}`,
        'user-agent': 'evil/1.0',
      },
      data: { loginName: LOGIN_NAME, password: 'hunter2' },
    },
    // Arbitrary extra / breadcrumbs frequently carry provider detail + PII.
    extra: { providerDetail: PROVIDER_PROTO, loginName: LOGIN_NAME, token: ACCESS_TOKEN },
    breadcrumbs: [
      { category: 'auth', message: `login ${LOGIN_NAME}`, data: { token: ACCESS_TOKEN } },
    ],
    // Tags: only the known subset (traceId, code, …) may survive; everything else dropped.
    tags: { traceId: TRACE_ID, code: APP_CODE, loginName: LOGIN_NAME, secretTag: ACCESS_TOKEN },
    // Trace context: trace_id/span_id survive; trace.data (arbitrary attrs) is dropped.
    contexts: {
      trace: {
        trace_id: TRACE_ID,
        span_id: SPAN_ID,
        op: 'http.server',
        status: 'internal_error',
        data: { 'http.url': TOKEN_URL, loginName: LOGIN_NAME },
      },
      // A whole non-allowlisted context block — dropped.
      device: { name: LOGIN_NAME },
    },
    // server_name can be a hostname that leaks infra detail — dropped.
    server_name: 'auth-prod-node-7.internal',
    // Top-level message can carry raw detail — dropped (we keep only the neutral code).
    message: PROVIDER_PROTO,
  };
}

function serialize(event: Event | null): string {
  return JSON.stringify(event ?? {});
}

const FORBIDDEN = [LOGIN_NAME, USER_ID, PROVIDER_PROTO, ACCESS_TOKEN, COOKIE, TOKEN_URL, 'hunter2'];

describe('scrubEvent — allowlist (egress neutrality)', () => {
  it('drops EVERY forbidden string (loginName, provider proto, token URL, cookies)', () => {
    const scrubbed = serialize(scrubEvent(hostileEvent()));
    for (const secret of FORBIDDEN) {
      expect(scrubbed).not.toContain(secret);
    }
  });

  it('keeps the allowlisted fields (event_id, level, release, environment, timestamp, platform)', () => {
    const scrubbed = scrubEvent(hostileEvent());
    expect(scrubbed).not.toBeNull();
    expect(scrubbed?.event_id).toBe('ev-1234');
    expect(scrubbed?.level).toBe('error');
    expect(scrubbed?.release).toBe('auth-ui@1.2.3');
    expect(scrubbed?.environment).toBe('production');
    expect(scrubbed?.timestamp).toBe(1_700_000_000);
    expect(scrubbed?.platform).toBe('node');
  });

  it('reduces the exception to the neutral type/value with NO stacktrace vars or provider detail', () => {
    const scrubbed = scrubEvent(hostileEvent());
    const values = scrubbed?.exception?.values ?? [];
    expect(values.length).toBe(1);
    // Neutral type/value only — never the raw provider proto string.
    expect(values[0]?.value).not.toContain(PROVIDER_PROTO);
    expect(values[0]?.type).not.toBe('ProviderError');
    // Stack frames (which carried vars) must be gone.
    expect(values[0]?.stacktrace).toBeUndefined();
    // Mechanism (handled flag) is safe and may survive.
    expect(values[0]?.mechanism?.handled).toBe(true);
  });

  it('keeps trace_id/span_id in contexts.trace but drops trace.data (arbitrary attrs)', () => {
    const scrubbed = scrubEvent(hostileEvent());
    const trace = scrubbed?.contexts?.trace;
    expect(trace?.trace_id).toBe(TRACE_ID);
    expect(trace?.span_id).toBe(SPAN_ID);
    expect(trace?.op).toBe('http.server');
    expect(trace?.status).toBe('internal_error');
    expect(trace?.data).toBeUndefined();
    // Non-allowlisted context block is gone.
    expect(scrubbed?.contexts?.device).toBeUndefined();
  });

  it('keeps only the known tag subset (traceId, code) and drops all other tags', () => {
    const scrubbed = scrubEvent(hostileEvent());
    expect(scrubbed?.tags?.traceId).toBe(TRACE_ID);
    expect(scrubbed?.tags?.code).toBe(APP_CODE);
    expect(scrubbed?.tags?.loginName).toBeUndefined();
    expect(scrubbed?.tags?.secretTag).toBeUndefined();
  });

  it('drops user, request, extra, breadcrumbs, server_name, and top-level message entirely', () => {
    const scrubbed = scrubEvent(hostileEvent());
    expect(scrubbed?.user).toBeUndefined();
    expect(scrubbed?.request).toBeUndefined();
    expect(scrubbed?.extra).toBeUndefined();
    expect(scrubbed?.breadcrumbs).toBeUndefined();
    expect(scrubbed?.server_name).toBeUndefined();
    expect(scrubbed?.message).toBeUndefined();
  });

  it('is NOT a pass-through — a fresh hostile event still leaks if untouched (sanity guard)', () => {
    // If the scrubber were `(e) => e`, the raw event WOULD contain every secret.
    // This asserts the precondition so the drop tests above are meaningful.
    const raw = serialize(hostileEvent());
    for (const secret of FORBIDDEN) {
      expect(raw).toContain(secret);
    }
  });
});
