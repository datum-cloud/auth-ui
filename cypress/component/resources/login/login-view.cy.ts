// cypress/component/resources/login/login-view.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/login-view.test.ts.
// Pure rendering-decision functions → browser-side Chai only.
import type { IdProvider } from '@/modules/auth/types';
import {
  resolveLoginView,
  attemptsRemaining,
  resolveIdentifierField,
} from '@/resources/login/login-view';

const settings = (
  o: Partial<{
    allowPassword: boolean;
    allowRegister: boolean;
    allowExternalIdp: boolean;
    passkeysAllowed: boolean;
    disableLoginWithEmail: boolean;
  }>
) => ({
  allowPassword: o.allowPassword ?? false,
  allowRegister: o.allowRegister ?? false,
  allowExternalIdp: o.allowExternalIdp ?? false,
  passkeysType: o.passkeysAllowed ? ('allowed' as const) : ('not_allowed' as const),
  disableLoginWithEmail: o.disableLoginWithEmail ?? false,
});
const idp: IdProvider = { id: 'idp-1', name: 'Google', type: 'GOOGLE' };

describe('resolveLoginView', () => {
  it('shows the password form only when allowPassword', () => {
    expect(resolveLoginView(settings({ allowPassword: true }), [], true).showPasswordForm).to.equal(
      true
    );
    expect(
      resolveLoginView(settings({ allowPassword: false }), [], true).showPasswordForm
    ).to.equal(false);
  });

  it('shows IdP buttons only when allowExternalIdp AND at least one idp', () => {
    expect(
      resolveLoginView(settings({ allowExternalIdp: true }), [idp], true).showIdpButtons
    ).to.equal(true);
    expect(
      resolveLoginView(settings({ allowExternalIdp: true }), [], true).showIdpButtons
    ).to.equal(false);
    expect(
      resolveLoginView(settings({ allowExternalIdp: false }), [idp], true).showIdpButtons
    ).to.equal(false);
  });

  it('shows the register link only when allowRegister', () => {
    expect(resolveLoginView(settings({ allowRegister: true }), [], true).showRegisterLink).to.equal(
      true
    );
    expect(
      resolveLoginView(settings({ allowRegister: false }), [], true).showRegisterLink
    ).to.equal(false);
  });

  it('surfaces the passkey prompt only when passkeys are allowed', () => {
    expect(
      resolveLoginView(settings({ passkeysAllowed: true }), [], true).showPasskeyPrompt
    ).to.equal(true);
    expect(
      resolveLoginView(settings({ passkeysAllowed: false }), [], true).showPasskeyPrompt
    ).to.equal(false);
  });

  it('flags sign-in unavailable when neither password, IdP, nor passkey is offered', () => {
    expect(resolveLoginView(settings({}), [], true).signInUnavailable).to.equal(true);
    expect(
      resolveLoginView(settings({ allowPassword: true }), [], true).signInUnavailable
    ).to.equal(false);
    expect(
      resolveLoginView(settings({ allowExternalIdp: true }), [idp], true).signInUnavailable
    ).to.equal(false);
  });

  it('passkey-only (no password, no IdP) is NOT unavailable', () => {
    const v = resolveLoginView(settings({ passkeysAllowed: true }), [], true);
    expect(v.signInUnavailable).to.equal(false);
    expect(v.showPasskeyPrompt).to.equal(true);
  });

  it('shows the email-link affordance by default', () => {
    expect(resolveLoginView(settings({}), [], true).showEmailLink).to.equal(true);
    expect(
      resolveLoginView(settings({ disableLoginWithEmail: false }), [], true).showEmailLink
    ).to.equal(true);
  });

  it('hides the email-link affordance when disableLoginWithEmail is set', () => {
    expect(
      resolveLoginView(settings({ disableLoginWithEmail: true }), [], true).showEmailLink
    ).to.equal(false);
  });

  it('hides email link when email delivery is disabled', () => {
    expect(resolveLoginView(settings({}), [], false).showEmailLink).to.equal(false);
  });

  it('shows email link when email allowed AND delivery enabled', () => {
    expect(resolveLoginView(settings({}), [], true).showEmailLink).to.equal(true);
  });
});

describe('attemptsRemaining', () => {
  it('returns null when counts are absent', () => {
    expect(attemptsRemaining(undefined, undefined)).to.equal(null);
    expect(attemptsRemaining(2, undefined)).to.equal(null);
    expect(attemptsRemaining(undefined, 5)).to.equal(null);
  });

  it('reports remaining attempts before lockout', () => {
    expect(attemptsRemaining(2, 5)).to.deep.equal({ kind: 'remaining', count: 3 });
    expect(attemptsRemaining(4, 5)).to.deep.equal({ kind: 'remaining', count: 1 });
  });

  it('reports locked at or beyond the max', () => {
    expect(attemptsRemaining(5, 5)).to.deep.equal({ kind: 'locked' });
    expect(attemptsRemaining(6, 5)).to.deep.equal({ kind: 'locked' });
  });
});

describe('resolveIdentifierField', () => {
  it('email+phone allowed (both flags off) → today default', () => {
    expect(resolveIdentifierField({})).to.deep.equal({
      allowEmail: true,
      allowPhone: true,
      rejectPhone: false,
    });
  });

  it('phone disabled → allowPhone false + rejectPhone true', () => {
    expect(resolveIdentifierField({ disableLoginWithPhone: true })).to.deep.equal({
      allowEmail: true,
      allowPhone: false,
      rejectPhone: true,
    });
  });

  it('email disabled → allowEmail false, phone still allowed', () => {
    expect(resolveIdentifierField({ disableLoginWithEmail: true })).to.deep.equal({
      allowEmail: false,
      allowPhone: true,
      rejectPhone: false,
    });
  });

  it('both disabled → username only + rejectPhone', () => {
    expect(
      resolveIdentifierField({ disableLoginWithEmail: true, disableLoginWithPhone: true })
    ).to.deep.equal({
      allowEmail: false,
      allowPhone: false,
      rejectPhone: true,
    });
  });
});
