import { postRegisterStep } from './post-register';
import { describe, it, expect } from 'vitest';

const base = { loginName: 'a@acme.test', userId: 'user-1', organization: 'org1' };

describe('postRegisterStep', () => {
  it('routes a no-password registration to passkey setup', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: false,
        emailVerified: false,
        requireVerification: true,
      })
    ).toMatch(/^\/setup\/passkey\?/);
  });
  it('routes password + verification-required + unverified to /verify, threading userId', () => {
    const r = postRegisterStep({
      ...base,
      hasPassword: true,
      emailVerified: false,
      requireVerification: true,
    });
    expect(r).toMatch(/^\/verify\?/);
    expect(r).toContain('userId=user-1');
  });
  it('routes password + verified to /signed-in when no requestId', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: true,
        requireVerification: true,
      })
    ).toBe('/signed-in');
  });
  it('hands back to /authorize when a requestId is present', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: true,
        requireVerification: true,
        requestId: 'oidc_1',
      })
    ).toBe('/authorize?requestId=oidc_1');
  });
  it('skips /verify when verification is not required', () => {
    expect(
      postRegisterStep({
        ...base,
        hasPassword: true,
        emailVerified: false,
        requireVerification: false,
      })
    ).toBe('/signed-in');
  });
});
