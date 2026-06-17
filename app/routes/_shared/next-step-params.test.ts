import { nextStepWithParams } from './next-step-params';
import type { Factors, LoginSettings } from '@/providers/types';
import { describe, it, expect } from 'vitest';

// Primary fresh + no MFA required → target is /signed-in; only the requestId param differs.
// passwordCheckLifetimeMs undefined → primaryFresh never expires (deterministic regardless of Date.now()).
const factors = { password: { verifiedAt: '2999-01-01T00:00:00.000Z' } } as unknown as Factors;
const settings = {
  allowPassword: true,
  allowExternalIdp: true,
  allowRegister: false,
  passkeysType: 'not_allowed',
  passwordCheckLifetimeMs: undefined,
  forceMfa: false,
  forceMfaLocalOnly: false,
} as unknown as LoginSettings;

describe('nextStepWithParams requestId validation (CODE-MIN-13)', () => {
  it('threads a well-formed requestId', () => {
    const url = nextStepWithParams({ factors, settings, requestId: 'oidc_abc' });
    expect(url).toContain('requestId=oidc_abc');
  });

  it('drops a requestId that fails the prefix allowlist', () => {
    const url = nextStepWithParams({ factors, settings, requestId: 'evil://x' });
    expect(url).not.toContain('requestId');
  });
});
