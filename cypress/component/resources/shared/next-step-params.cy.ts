// cypress/component/resources/shared/next-step-params.cy.ts
//
// Component (no-mount) port of app/resources/shared/__tests__/next-step-params.test.ts.
// Pure routing helpers (authorizeHandbackTarget, nextStepWithParams, nextStepFromSession)
// → browser-side Chai only.
import type { Factors, LoginSettings, Session } from '@/modules/auth/types';
import {
  authorizeHandbackTarget,
  nextStepFromSession,
  nextStepWithParams,
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

describe('authorizeHandbackTarget', () => {
  it('routes a device_ requestId to /signed-in (auto-complete), NOT /authorize', () => {
    const target = authorizeHandbackTarget('device_LQWC-KMNH', 'sess-1');
    expect(target).to.equal('/signed-in?requestId=device_LQWC-KMNH');
    expect(target).not.to.contain('/authorize');
  });

  it('routes an oidc_ requestId back into /authorize with the explicit sessionId', () => {
    const target = authorizeHandbackTarget('oidc_abc', 'sess-1');
    expect(target).to.equal('/authorize?requestId=oidc_abc&sessionId=sess-1');
  });

  it('routes a saml_ requestId back into /authorize with the explicit sessionId', () => {
    const target = authorizeHandbackTarget('saml_xyz', 'sess-1');
    expect(target).to.equal('/authorize?requestId=saml_xyz&sessionId=sess-1');
  });

  it('falls back to the terminal /signed-in when no requestId is present', () => {
    expect(authorizeHandbackTarget(undefined, 'sess-1')).to.equal('/signed-in');
  });
});

describe('nextStepWithParams requestId validation', () => {
  it('threads a well-formed requestId', () => {
    const url = nextStepWithParams({ factors, settings, requestId: 'oidc_abc' });
    expect(url).to.contain('requestId=oidc_abc');
  });

  it('drops a requestId that fails the prefix allowlist', () => {
    const url = nextStepWithParams({ factors, settings, requestId: 'evil://x' });
    expect(url).not.to.contain('requestId');
  });
});

describe('nextStepWithParams — no duplicated ceremony params (F3)', () => {
  const setupMfaSettings = {
    ...settings,
    forceMfa: false,
    mfaInitSkipLifetimeMs: 10_000,
  } as unknown as LoginSettings;

  function paramCount(url: string, key: string): number {
    const qs = url.slice(url.indexOf('?') + 1);
    return new URLSearchParams(qs).getAll(key).length;
  }

  it('emits loginName exactly once on the /setup/mfa target', () => {
    const url = nextStepWithParams({
      factors,
      settings: setupMfaSettings,
      enrolledMethods: [],
      loginName: 'zitadel-e2e-user3',
      mfaInitSkippedAt: null,
    });
    expect(url).to.contain('/setup/mfa');
    expect(url).to.contain('force=false');
    expect(url).not.to.contain('loginName=zitadel-e2e-user3&loginName=zitadel-e2e-user3');
    expect(paramCount(url, 'loginName')).to.equal(1);
  });

  it('emits requestId and organization exactly once each when threaded onto /setup/mfa', () => {
    const url = nextStepWithParams({
      factors,
      settings: setupMfaSettings,
      enrolledMethods: [],
      loginName: 'zitadel-e2e-user3',
      requestId: 'oidc_abc',
      organization: 'acme',
      mfaInitSkippedAt: null,
    });
    expect(paramCount(url, 'loginName')).to.equal(1);
    expect(paramCount(url, 'requestId')).to.equal(1);
    expect(paramCount(url, 'organization')).to.equal(1);
    expect(url).to.contain('checkAfter=true');
  });
});

describe('nextStepFromSession (shared assembly)', () => {
  const setupMfaSettings = {
    ...settings,
    forceMfa: false,
    mfaInitSkipLifetimeMs: 10_000,
  } as unknown as LoginSettings;

  it('forwards the caller loginName verbatim, ignoring session.user.loginName', () => {
    const session = {
      factors,
      user: { id: 'u1', loginName: 'session-user@x.test' },
    } as unknown as Session;
    const url = nextStepFromSession({
      session,
      methods: [],
      settings: setupMfaSettings,
      loginName: 'raw-typed@x.test',
      mfaInitSkippedAt: null,
    });
    expect(url).to.contain('loginName=raw-typed%40x.test');
    expect(url).not.to.contain('session-user');
  });

  it('forwards the caller mfaInitSkippedAt (fresh value) so a recent skip routes past setup', () => {
    const session = {
      factors,
      user: { id: 'u1', loginName: 'a@x.test', mfaInitSkippedAt: null },
    } as unknown as Session;
    const recent = new Date().toISOString();
    const url = nextStepFromSession({
      session,
      methods: [],
      settings: setupMfaSettings,
      loginName: 'a@x.test',
      mfaInitSkippedAt: recent,
    });
    expect(url).not.to.contain('/setup/mfa');
  });

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
