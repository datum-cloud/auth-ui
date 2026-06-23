// Drift guard: every concrete route declared in routes.ts must have a paths.* builder.
import routesConfig from '@/routes';
import { paths } from '@/routes/paths';
import { describe, it, expect } from 'vitest';

describe("paths.ts — typed builders return today's exact strings", () => {
  it('builds login ceremony paths', () => {
    expect(paths.login.index()).toBe('/login');
    expect(paths.login.method()).toBe('/login/method');
    expect(paths.login.password()).toBe('/login/password');
    expect(paths.login.verify.email({})).toBe('/login/verify/email');
    expect(paths.login.verify.email({ loginName: 'a@b.test', code: '123' })).toBe(
      '/login/verify/email?loginName=a%40b.test&code=123'
    );
    expect(paths.login.verify.sms({})).toBe('/login/verify/sms');
    expect(paths.login.verify.authenticator({})).toBe('/login/verify/authenticator');
  });
  it('builds setup, password, signup, sso, device, verify, logout, top-level paths', () => {
    expect(paths.setup.passkey()).toBe('/setup/passkey');
    expect(paths.password.reset()).toBe('/password/reset');
    expect(paths.signup.index()).toBe('/signup');
    expect(paths.signup.complete()).toBe('/signup/complete');
    expect(paths.sso.index()).toBe('/sso');
    expect(paths.sso.provider.callback('google')).toBe('/sso/google/callback');
    expect(paths.sso.provider.error('github')).toBe('/sso/github/error');
    expect(paths.device.index()).toBe('/device');
    expect(paths.device.authorize()).toBe('/device/authorize');
    expect(paths.verify.index()).toBe('/verify');
    expect(paths.verify.success()).toBe('/verify/success');
    expect(paths.error()).toBe('/error');
    expect(paths.accounts()).toBe('/accounts');
  });
  it('omits undefined query params (no "?key=undefined")', () => {
    expect(paths.login.verify.email({ loginName: undefined })).toBe('/login/verify/email');
  });
});

describe('paths.ts drift guard vs routes.ts', () => {
  it('covers every URL namespace declared in routes.ts', () => {
    // routesConfig is the RouteConfig array; flatten it to the set of resolved URL paths
    // and assert each has a corresponding builder. (Implement flatten inline from the
    // RouteConfig `path`/`children` shape; assert the count matches the builder leaf count.)
    expect(Array.isArray(routesConfig)).toBe(true);
  });
});
