// cypress/component/resources/login/login-decision.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/login-decision.test.ts.
// decideAfterIdentifier is a pure routing function → browser-side Chai only.
import type { AuthMethod, LoginSettings } from '@/modules/auth/types';
import { decideAfterIdentifier } from '@/resources/login/login-decision';

const settings: LoginSettings = {
  allowPassword: true,
  allowRegister: true,
  allowExternalIdp: true,
  passkeysType: 'allowed',
  forceMfa: false,
};

const PRIMARY = { role: 'primary' } as const;

describe('decideAfterIdentifier → discriminated Decision union', () => {
  it('routes a password-only user to /login/password', () => {
    const methods: AuthMethod[] = ['password'];
    const d = decideAfterIdentifier({
      methods,
      settings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/password' });
  });

  it('routes to /login/method when 2+ primary methods are available (was: prefers passkey)', () => {
    const methods: AuthMethod[] = ['password', 'passkey'];
    const d = decideAfterIdentifier({
      methods,
      settings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/method' });
  });

  it('routes to /verify (invite) when the user has no auth methods', () => {
    const d = decideAfterIdentifier({
      methods: [],
      settings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/verify' });
  });

  it('errors when password is the only method but allowPassword is false', () => {
    const d = decideAfterIdentifier({
      methods: ['password'],
      settings: { ...settings, allowPassword: false },
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'error', error: 'PASSWORD_NOT_ALLOWED' });
  });

  it('does NOT route to /sso when allowExternalIdp is false (policy gate)', () => {
    const d = decideAfterIdentifier({
      methods: ['idp', 'password'],
      settings: {
        allowPassword: true,
        allowExternalIdp: false,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/password' });
  });

  it('routes to /sso when allowExternalIdp is true and idp is enrolled', () => {
    const d = decideAfterIdentifier({
      methods: ['idp'],
      settings: {
        allowPassword: true,
        allowExternalIdp: true,
        passkeysType: 'not_allowed',
      } as LoginSettings,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/sso' });
  });

  const s = {
    allowPassword: true,
    allowExternalIdp: true,
    passkeysType: 'allowed',
  } as LoginSettings;

  it('routes an email-only user to /login/verify/email (otp_email as PRIMARY, mfa role excluded)', () => {
    const d = decideAfterIdentifier({
      methods: ['otp_email'],
      settings: s,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/verify/email' });
  });

  it('routes a 2+ primary-method user to /login/method', () => {
    const d = decideAfterIdentifier({
      methods: ['passkey', 'otp_email'],
      settings: s,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/method' });
  });

  it('keeps single-method password routing unchanged', () => {
    const d = decideAfterIdentifier({
      methods: ['password'],
      settings: s,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/password' });
  });

  it('excludes otp_email as a primary when email delivery is off', () => {
    const d = decideAfterIdentifier({
      methods: ['otp_email'],
      settings: s,
      emailDeliveryEnabled: false,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'error', error: 'NO_SUPPORTED_METHOD' });
  });

  it('keeps otp_email when delivery is on', () => {
    const d = decideAfterIdentifier({
      methods: ['otp_email'],
      settings: s,
      emailDeliveryEnabled: true,
      context: PRIMARY,
    });
    expect(d).to.deep.equal({ kind: 'redirect', path: '/login/verify/email' });
  });
});
