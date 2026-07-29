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

const IDP = [{ id: 'i', name: 'G', type: 'oidc' } as never];

describe('resolveLoginView', () => {
  // The identifier field is a prerequisite for password, passkey (usernameless is
  // unsupported upstream — zitadel/zitadel#8899) AND email-link, so it must not be
  // gated on allowPassword alone.
  it('shows the identifier form for password, passkey, or email-link independently', () => {
    expect(
      resolveLoginView(settings({ allowPassword: true }), [], false).showIdentifierForm
    ).to.equal(true);
    expect(
      resolveLoginView(settings({ passkeysAllowed: true }), [], false).showIdentifierForm
    ).to.equal(true);
    // email-link alone: delivery on, org has not disabled email login.
    expect(resolveLoginView(settings({}), [], true).showIdentifierForm).to.equal(true);
    // nothing at all → no form.
    expect(resolveLoginView(settings({}), [], false).showIdentifierForm).to.equal(false);
  });

  // REGRESSION: a passkey-only org with no loginName used to render an EMPTY card — the
  // identifier form was hidden (allowPassword false) while signInUnavailable was
  // suppressed by showPasskeyPrompt, so there was no sign-in path AND no error.
  it('gives a passkey-only org a reachable identifier form, not an empty card', () => {
    const view = resolveLoginView(settings({ passkeysAllowed: true }), [], false);
    expect(view.showIdentifierForm).to.equal(true);
    expect(view.showContinue).to.equal(true);
    expect(view.signInUnavailable).to.equal(false);
  });

  // "Continue" routes through decideAfterIdentifier; with neither password nor passkey
  // that resolves to NO_SUPPORTED_METHOD, so the button must not render.
  it('hides Continue when only email-link is available, but keeps the form', () => {
    const view = resolveLoginView(settings({}), [], true);
    expect(view.showContinue).to.equal(false);
    expect(view.showEmailLink).to.equal(true);
    expect(view.showIdentifierForm).to.equal(true);
    expect(view.signInUnavailable).to.equal(false);
  });

  it('flags sign-in unavailable only when neither an identifier nor an IdP path exists', () => {
    // No password, no passkey, no IdP, email delivery OFF → genuinely unavailable.
    expect(resolveLoginView(settings({}), [], false).signInUnavailable).to.equal(true);
    expect(
      resolveLoginView(settings({ allowPassword: true }), [], false).signInUnavailable
    ).to.equal(false);
    // An IdP alone clears it even with no identifier path.
    expect(
      resolveLoginView(settings({ allowExternalIdp: true }), IDP, false).signInUnavailable
    ).to.equal(false);
    // Email delivery on is itself a path (reverses the 2026-07-06 assumption).
    expect(resolveLoginView(settings({}), [], true).signInUnavailable).to.equal(false);
    // …but not when the org disabled email login.
    expect(
      resolveLoginView(settings({ disableLoginWithEmail: true }), [], true).signInUnavailable
    ).to.equal(true);
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
