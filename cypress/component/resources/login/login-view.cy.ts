// cypress/component/resources/login/login-view.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/login-view.test.ts.
// Pure rendering-decision functions → browser-side Chai only.
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

describe('resolveLoginView', () => {
  it('flags sign-in unavailable when neither password, IdP, nor passkey is offered', () => {
    expect(resolveLoginView(settings({}), [], true).signInUnavailable).to.equal(true);
    expect(
      resolveLoginView(settings({ allowPassword: true }), [], true).signInUnavailable
    ).to.equal(false);
  });
});

describe('attemptsRemaining + resolveIdentifierField', () => {
  it('reports locked at or beyond the max, and both-disabled → username only + rejectPhone', () => {
    expect(attemptsRemaining(5, 5)).to.deep.equal({ kind: 'locked' });
    expect(attemptsRemaining(6, 5)).to.deep.equal({ kind: 'locked' });
    expect(
      resolveIdentifierField({ disableLoginWithEmail: true, disableLoginWithPhone: true })
    ).to.deep.equal({
      allowEmail: false,
      allowPhone: false,
      rejectPhone: true,
    });
  });
});
