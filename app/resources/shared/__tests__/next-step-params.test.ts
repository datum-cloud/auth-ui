import { nextStepWithParams } from '../next-step-params';
import type { Factors, LoginSettings } from '@/modules/auth/types';
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
