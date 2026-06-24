import { authorizeHandbackTarget, nextStepFromSession, nextStepWithParams } from '../next-step-params';
import type { Factors, LoginSettings, Session } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

// Primary fresh + no MFA required → target is /signed-in; only the requestId param differs.
// passwordCheckLifetimeMs undefined → primaryFresh never expires (deterministic regardless of Date.now()).
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

// authorizeHandbackTarget is the IdP/signup hand-back router (sso-callback, idp-session,
// signup.service). It must dispatch by requestId prefix the SAME way the password path's
// /signed-in does — crucially, a device_ grant is NOT an OIDC/SAML auth request and must finish
// via /signed-in (→ resolveDeviceCompletion auto-authorize), NOT /authorize (which mis-resolves
// it → default cloud-portal redirect). This pins the device-add-during-grant return flow.
describe('authorizeHandbackTarget', () => {
  it('routes a device_ requestId to /signed-in (auto-complete), NOT /authorize', () => {
    const target = authorizeHandbackTarget('device_LQWC-KMNH', 'sess-1');
    expect(target).toBe('/signed-in?requestId=device_LQWC-KMNH');
    expect(target).not.toContain('/authorize');
  });

  it('routes an oidc_ requestId back into /authorize with the explicit sessionId', () => {
    const target = authorizeHandbackTarget('oidc_abc', 'sess-1');
    expect(target).toBe('/authorize?requestId=oidc_abc&sessionId=sess-1');
  });

  it('routes a saml_ requestId back into /authorize with the explicit sessionId', () => {
    const target = authorizeHandbackTarget('saml_xyz', 'sess-1');
    expect(target).toBe('/authorize?requestId=saml_xyz&sessionId=sess-1');
  });

  it('falls back to the terminal /signed-in when no requestId is present', () => {
    expect(authorizeHandbackTarget(undefined, 'sess-1')).toBe('/signed-in');
  });
});

describe('nextStepWithParams requestId validation', () => {
  it('threads a well-formed requestId', () => {
    const url = nextStepWithParams({ factors, settings, requestId: 'oidc_abc' });
    expect(url).toContain('requestId=oidc_abc');
  });

  it('drops a requestId that fails the prefix allowlist', () => {
    const url = nextStepWithParams({ factors, settings, requestId: 'evil://x' });
    expect(url).not.toContain('requestId');
  });
});

// F3: nextStep already bakes the ceremony params (loginName/requestId/organization) into the
// /setup/mfa target's query; nextStepWithParams must MERGE into that query, not blindly append,
// so a param is never duplicated (`loginName=…&loginName=…`).
describe('nextStepWithParams — no duplicated ceremony params (F3)', () => {
  // Primary fresh, no 2nd factor enrolled, not forced, skip window set + never skipped →
  // step-6 skippable setup: /setup/mfa?force=false&checkAfter=true (loginName baked in by nextStep).
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
    expect(url).toContain('/setup/mfa');
    expect(url).toContain('force=false');
    expect(url).not.toContain('loginName=zitadel-e2e-user3&loginName=zitadel-e2e-user3');
    expect(paramCount(url, 'loginName')).toBe(1);
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
    expect(paramCount(url, 'loginName')).toBe(1);
    expect(paramCount(url, 'requestId')).toBe(1);
    expect(paramCount(url, 'organization')).toBe(1);
    // MFA-specific params nextStep set are preserved.
    expect(url).toContain('checkAfter=true');
  });
});

// The shared nextStepFromSession helper forwards the caller-resolved loginName and
// mfaInitSkippedAt VERBATIM (it must NOT re-derive them from session.user — the divergent
// sources are the whole reason the values are passed in). It derives userVerified from the
// session's passkey factor.
describe('nextStepFromSession (shared assembly)', () => {
  const setupMfaSettings = {
    ...settings,
    forceMfa: false,
    mfaInitSkipLifetimeMs: 10_000,
  } as unknown as LoginSettings;

  it('forwards the caller loginName verbatim, ignoring session.user.loginName', () => {
    // session.user carries a DIFFERENT loginName — the helper must use the passed one.
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
    expect(url).toContain('loginName=raw-typed%40x.test');
    expect(url).not.toContain('session-user');
  });

  it('forwards the caller mfaInitSkippedAt (fresh value) so a recent skip routes past setup', () => {
    // session.user has NO skip stamp; the caller passes a fresh, recent skip → setup nudge suppressed.
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
    // A fresh skip routes to /signed-in, NOT /setup/mfa.
    expect(url).not.toContain('/setup/mfa');
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
    expect(url).toContain('/signed-in');
  });
});
