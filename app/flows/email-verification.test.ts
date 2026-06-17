import { emailVerificationGate } from './email-verification';
import { describe, it, expect } from 'vitest';

const base = { loginName: 'a@acme.test', organization: 'org1' };

describe('emailVerificationGate', () => {
  it('returns null when the email is already verified', () => {
    expect(
      emailVerificationGate({ ...base, emailVerified: true, requireVerification: true })
    ).toBeNull();
  });
  it('returns null when verification is not required by policy', () => {
    expect(
      emailVerificationGate({ ...base, emailVerified: false, requireVerification: false })
    ).toBeNull();
  });
  it('redirects to /verify with send=true when unverified and required', () => {
    const r = emailVerificationGate({ ...base, emailVerified: false, requireVerification: true });
    expect(r?.redirect).toMatch(/^\/verify\?/);
    expect(r?.redirect).toContain('send=true');
    expect(r?.redirect).toContain('loginName=a%40acme.test');
    expect(r?.redirect).toContain('organization=org1');
  });
  it('threads requestId when present', () => {
    const r = emailVerificationGate({
      ...base,
      emailVerified: false,
      requireVerification: true,
      requestId: 'oidc_9',
    });
    expect(r?.redirect).toContain('requestId=oidc_9');
  });
});
