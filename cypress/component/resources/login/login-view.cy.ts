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

type View = ReturnType<typeof resolveLoginView>;
type Args = Parameters<typeof resolveLoginView>;

describe('resolveLoginView', () => {
  // Consolidated from three one-shape tests (identifier-form gating, email-link-only
  // Continue suppression, signInUnavailable matrix) into one labeled partial table —
  // the same [label, Args, Partial<View>] pattern as signup-view.cy.ts. Every original
  // assertion is preserved as a row/field; a failure names '<row> → <field>'.
  const CASES: [string, Args, Partial<View>][] = [
    // ── showIdentifierForm ────────────────────────────────────────────────────────────
    // The identifier field is a prerequisite for password, passkey (usernameless is
    // unsupported upstream — zitadel/zitadel#8899) AND email-link, so it must not be
    // gated on allowPassword alone.
    [
      'password alone shows the identifier form',
      [settings({ allowPassword: true }), [], false],
      { showIdentifierForm: true },
    ],
    [
      'passkey alone shows the identifier form',
      [settings({ passkeysAllowed: true }), [], false],
      { showIdentifierForm: true },
    ],
    ['nothing at all → no form', [settings({}), [], false], { showIdentifierForm: false }],
    // ── email OTP sign-in hidden (EMAIL_OTP_SIGNIN_ENABLED=false) ────────────────────
    // These rows previously asserted the opposite: delivery alone justified the field, and an
    // email-only org got a form without Continue. With the entry point hidden nothing sits
    // behind it, so it contributes neither the button nor the form, and an org with no other
    // method genuinely cannot sign in — better than a form with no submit button. They invert
    // again when the flag is flipped, which keeps re-enabling a deliberate edit.
    [
      'email-link alone no longer shows the identifier form',
      [settings({}), [], true],
      {
        showContinue: false,
        showEmailLink: false,
        showIdentifierForm: false,
        signInUnavailable: true,
      },
    ],
    // ── signInUnavailable: only when neither an identifier nor an IdP path exists ─────
    [
      'no password, no passkey, no IdP, delivery off → genuinely unavailable',
      [settings({}), [], false],
      { signInUnavailable: true },
    ],
    [
      'password alone clears unavailable',
      [settings({ allowPassword: true }), [], false],
      { signInUnavailable: false },
    ],
    // An IdP alone clears it even with no identifier path.
    [
      'an IdP alone clears unavailable',
      [settings({ allowExternalIdp: true }), IDP, false],
      { signInUnavailable: false },
    ],
    // Delivery on is no longer a path of its own while email OTP sign-in is hidden.
    [
      'email delivery on no longer clears unavailable',
      [settings({}), [], true],
      { signInUnavailable: true },
    ],
    // …but not when the org disabled email login.
    [
      'delivery on but org disabled email login → unavailable',
      [settings({ disableLoginWithEmail: true }), [], true],
      { signInUnavailable: true },
    ],
  ];

  it('resolves identifier form, Continue, and unavailability across the policy matrix', () => {
    for (const [label, args, expected] of CASES) {
      const view = resolveLoginView(...args);
      for (const [field, value] of Object.entries(expected)) {
        expect(view[field as keyof View], `${label} → ${field}`).to.equal(value);
      }
    }
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
