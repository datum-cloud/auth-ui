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
  it('builds the bare reason-only URL when no ceremony context is given', () => {
    const url = ssoErrorRedirect('google', 'context-missing');
    expect(url).to.equal('/sso/google/error?reason=context-missing');
  });

  it('threads requestId and organization onto the error redirect when present', () => {
    const url = ssoErrorRedirect('google', 'signin_failed', 'oidc_V2_123', 'org-1');
    expect(url).to.equal(
      '/sso/google/error?reason=signin_failed&requestId=oidc_V2_123&organization=org-1'
    );
  });

  it('threads requestId alone (organization omitted) without a stray param', () => {
    const url = ssoErrorRedirect('google', 'signin_failed', 'oidc_V2_123');
    expect(url).to.equal('/sso/google/error?reason=signin_failed&requestId=oidc_V2_123');
  });

  it('URL-encodes the slug and reason', () => {
    const url = ssoErrorRedirect('my provider', 'some/reason');
    expect(url).to.equal('/sso/my%20provider/error?reason=some%2Freason');
  });
});

describe('loginBounceTarget — resource-layer /login guard-fail bounce (mirrors routes/login-bounce.ts)', () => {
  it('bounces to a bare /login when no requestId is present', () => {
    expect(loginBounceTarget()).to.equal('/login');
    expect(loginBounceTarget(undefined, 'org-1')).to.equal('/login'); // org never leaks alone
  });

  it('threads requestId + organization when a requestId is present', () => {
    expect(loginBounceTarget('oidc_V2_123', 'org-1')).to.equal(
      '/login?requestId=oidc_V2_123&organization=org-1'
    );
  });

  it('threads requestId alone when organization is absent', () => {
    expect(loginBounceTarget('oidc_V2_123')).to.equal('/login?requestId=oidc_V2_123');
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
