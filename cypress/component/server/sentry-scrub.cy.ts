// cypress/component/server/sentry-scrub.cy.ts
// COMPONENT port of app/server/__tests__/sentry-scrub.test.ts
// Pure allowlist scrubber — no node deps.
import { scrubEvent } from '@/server/sentry-scrub';
import type { ErrorEvent, Event } from '@sentry/react-router';

const LOGIN_NAME = 'alice@victim.example.com';
const USER_ID = 'user-9f3c-secret';
const PROVIDER_PROTO = 'zitadel.session.v2.CheckPassword: PERMISSION_DENIED (grpc code 7)';
const ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.PAYLOAD.SIGNATURE';
const TOKEN_URL = `https://auth.localtest.me/id/login?access_token=${ACCESS_TOKEN}&loginName=${LOGIN_NAME}`;
const COOKIE = `__session=${ACCESS_TOKEN}; csrf=deadbeef`;
const APP_CODE = 'INVALID_CREDENTIALS';
const TRACE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SPAN_ID = '0011223344556677';

function hostileEvent(): ErrorEvent {
  return {
    type: undefined,
    event_id: 'ev-1234',
    timestamp: 1_700_000_000,
    level: 'error',
    platform: 'node',
    release: 'auth-ui@1.2.3',
    environment: 'production',
    exception: {
      values: [
        {
          type: 'ProviderError',
          value: PROVIDER_PROTO,
          mechanism: { handled: true, type: 'generic' },
          stacktrace: {
            frames: [
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
    user: { id: USER_ID, email: LOGIN_NAME, username: LOGIN_NAME, ip_address: '203.0.113.7' },
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
    extra: { providerDetail: PROVIDER_PROTO, loginName: LOGIN_NAME, token: ACCESS_TOKEN },
    breadcrumbs: [
      { category: 'auth', message: `login ${LOGIN_NAME}`, data: { token: ACCESS_TOKEN } },
    ],
    tags: { traceId: TRACE_ID, code: APP_CODE, loginName: LOGIN_NAME, secretTag: ACCESS_TOKEN },
    contexts: {
      trace: {
        trace_id: TRACE_ID,
        span_id: SPAN_ID,
        op: 'http.server',
        status: 'internal_error',
        data: { 'http.url': TOKEN_URL, loginName: LOGIN_NAME },
      },
      device: { name: LOGIN_NAME },
    },
    server_name: 'auth-prod-node-7.internal',
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
      expect(scrubbed).not.to.include(secret);
    }
  });

  it('keeps the allowlisted fields (event_id, level, release, environment, timestamp, platform)', () => {
    const scrubbed = scrubEvent(hostileEvent());
    expect(scrubbed).not.to.be.null;
    expect(scrubbed?.event_id).to.equal('ev-1234');
    expect(scrubbed?.level).to.equal('error');
    expect(scrubbed?.release).to.equal('auth-ui@1.2.3');
    expect(scrubbed?.environment).to.equal('production');
    expect(scrubbed?.timestamp).to.equal(1_700_000_000);
    expect(scrubbed?.platform).to.equal('node');
  });

  it('drops user, request, extra, breadcrumbs, server_name, and top-level message entirely', () => {
    const scrubbed = scrubEvent(hostileEvent());
    expect(scrubbed?.user).to.be.undefined;
    expect(scrubbed?.request).to.be.undefined;
    expect(scrubbed?.extra).to.be.undefined;
    expect(scrubbed?.breadcrumbs).to.be.undefined;
    expect(scrubbed?.server_name).to.be.undefined;
    expect(scrubbed?.message).to.be.undefined;
  });

  it('is NOT a pass-through — a fresh hostile event still leaks if untouched (sanity guard)', () => {
    const raw = serialize(hostileEvent());
    for (const secret of FORBIDDEN) {
      expect(raw).to.include(secret);
    }
  });
});
