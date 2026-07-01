// cypress/component/resources/sso/sso-action.cy.ts
//
// cy.task node-spec port of the runSsoAction cases of app/resources/sso/__tests__/sso.service.test.ts.
// runSsoAction resolves the trusted origin via env.server PUBLIC_ORIGIN (real env, set per scenario),
// reads the session cookie on the unlink path, and emits REAL logAuthEvent audit — node-bound.
// (The ALLOW_IDP_UNLINK env-schema cases moved to app/utils/env/__tests__/env.server.test.ts.)
import { callService } from '../../../support/node/call-service';

const PUBLIC_ORIGIN = 'https://auth.localtest.me:30000';
const BASE = 'http://localhost/id/sso';
const SPOOFED = 'http://evil.example/id/sso';

// SEC-5: ALLOW_IDP_UNLINK must coerce ONLY the exact string 'true' to boolean true and fail-closed
// otherwise. Driven through the REAL env.server _envSchema via the parseEnv cy.task (env.server is
// stubbed out of the browser bundle, so this cannot run as a plain component import). SESSION_SECRET
// must be ≥32 chars (HMAC-SHA256 key) for the schema to parse.
const ENV_BASE = { SESSION_SECRET: 'x'.repeat(32) };
type ParseEnvOutcome = { success: boolean; ALLOW_IDP_UNLINK?: boolean };

describe('ALLOW_IDP_UNLINK env parsing (SEC-5, fail-closed)', () => {
  it('defaults to boolean false when unset (fail-closed)', () => {
    callService({
      fn: 'parseEnv',
      parseEnvRaw: { ...ENV_BASE },
      request: { url: BASE },
    }).then((v) => {
      expect((v.outcome as ParseEnvOutcome).ALLOW_IDP_UNLINK).to.equal(false);
    });
  });
});

describe('runSsoAction — provider error handling', () => {
  it('start: provider error returns a handled response and logs failure (no 500)', () => {
    callService({
      fn: 'runSsoAction',
      provider: 'singleton',
      startIdpIntentError: 'UNAVAILABLE',
      request: { url: BASE, form: { intent: 'start', provider: 'google' } },
    }).then((v) => {
      expect([302, 502]).to.include(v.response?.status);
      expect(v.audit.some((e) => e.outcome === 'failure')).to.equal(true);
    });
  });
});

describe('runSsoAction — start: provider slug is hardened against URL-injection chars', () => {
  it('rejects a slug with disallowed characters (path traversal / encoded payload) with a 400', () => {
    callService({
      fn: 'runSsoAction',
      provider: 'singleton',
      request: { url: BASE, form: { intent: 'start', provider: '../evil/../../callback' } },
    }).then((v) => {
      expect(v.response?.status).to.equal(400);
    });
  });
});

describe('runSsoAction — IdP start: organization must be threaded into idpReturnUrls', () => {
  it('sso start threads organization into the IdP success return URL (trusted origin, not Host)', () => {
    callService({
      fn: 'runSsoAction',
      provider: 'singleton',
      env: { PUBLIC_ORIGIN },
      recordCalls: ['startIdpIntent'],
      request: {
        url: SPOOFED,
        form: { intent: 'start', provider: 'google', organization: 'org-123' },
      },
    }).then((v) => {
      const calls = v.calls?.startIdpIntent ?? [];
      expect(calls.length).to.equal(1);
      const urls = calls[0][1] as { success: string; failure: string };
      expect(urls.success).to.include(`${PUBLIC_ORIGIN}/id/sso/`);
      expect(urls.success).to.include('organization=org-123');
    });
  });
});
