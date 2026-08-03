// cypress/component/resources/shared/next-step-params.cy.ts
//
// Component (no-mount) port of app/resources/shared/__tests__/next-step-params.test.ts.
// Pure routing helpers (authorizeHandbackTarget, nextStepWithParams, nextStepFromSession)
// → browser-side Chai only.
import type { Factors, LoginSettings, Session } from '@/modules/auth/types';
import {
  nextStepFromSession,
  nextStepWithParams,
  ssoErrorRedirect,
  loginBounceTarget,
} from '@/resources/shared/next-step-params';

const factors = {
  password: { verifiedAt: new Date('2999-01-01T00:00:00.000Z') },
} as unknown as Factors;
const settings = {
  allowPassword: true,
  allowExternalIdp: true,
  allowRegister: false,
  passkeysType: 'not_allowed',
  passwordCheckLifetimeMs: undefined,
  forceMfa: false,
  forceMfaLocalOnly: false,
} as unknown as LoginSettings;

describe('nextStepWithParams requestId validation', () => {
  it('drops a requestId that fails the prefix allowlist', () => {
    const url = nextStepWithParams({ factors, settings, requestId: 'evil://x' });
    expect(url).not.to.contain('requestId');
  });
});

describe('ssoErrorRedirect — threads requestId/organization (regression: dropped on SSO error redirects)', () => {
  const CASES: [label: string, args: Parameters<typeof ssoErrorRedirect>, expected: string][] = [
    [
      'bare reason-only when no ceremony context',
      ['google', 'context-missing'],
      '/sso/google/error?reason=context-missing',
    ],
    [
      'requestId + organization both threaded',
      ['google', 'signin_failed', 'oidc_V2_123', 'org-1'],
      '/sso/google/error?reason=signin_failed&requestId=oidc_V2_123&organization=org-1',
    ],
    [
      'requestId alone, no stray organization param',
      ['google', 'signin_failed', 'oidc_V2_123'],
      '/sso/google/error?reason=signin_failed&requestId=oidc_V2_123',
    ],
    [
      'slug and reason are URL-encoded',
      ['my provider', 'some/reason'],
      '/sso/my%20provider/error?reason=some%2Freason',
    ],
  ];

  it('builds the error redirect for every ceremony-context combination, URL-encoding slug and reason', () => {
    for (const [label, args, expected] of CASES) {
      expect(ssoErrorRedirect(...args), label).to.equal(expected);
    }
  });
});

describe('loginBounceTarget — resource-layer /login guard-fail bounce (mirrors routes/login-bounce.ts)', () => {
  const CASES: [label: string, args: Parameters<typeof loginBounceTarget>, expected: string][] = [
    ['no context', [], '/login'],
    // An organization must never leak onto the bounce without a requestId to scope it.
    ['organization alone never leaks', [undefined, 'org-1'], '/login'],
    [
      'requestId + organization',
      ['oidc_V2_123', 'org-1'],
      '/login?requestId=oidc_V2_123&organization=org-1',
    ],
    ['requestId alone', ['oidc_V2_123'], '/login?requestId=oidc_V2_123'],
  ];

  it('bounces to a bare /login without a requestId and threads requestId (+organization) when present', () => {
    for (const [label, args, expected] of CASES) {
      expect(loginBounceTarget(...args), label).to.equal(expected);
    }
  });
});

describe('nextStepFromSession (shared assembly)', () => {
  it('derives userVerified=true from the session passkey factor (passwordless shortcut)', () => {
    const passwordlessFactors = {
      passkey: { verifiedAt: new Date('2999-01-01T00:00:00.000Z'), userVerified: true },
    } as unknown as Factors;
    const session = {
      factors: passwordlessFactors,
      user: { id: 'u1', loginName: 'a@x.test' },
    } as unknown as Session;
    const url = nextStepFromSession({
      session,
      methods: [],
      settings,
      loginName: 'a@x.test',
      mfaInitSkippedAt: null,
    });
    expect(url).to.contain('/signed-in');
  });
});
