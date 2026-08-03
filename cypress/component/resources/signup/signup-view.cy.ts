// cypress/component/resources/signup/signup-view.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup-view.test.ts.
// Pure view resolver → browser-side Chai only.
//
// Consolidated from 16 one-assertion tests into two tables. Only 11 distinct
// resolveSignupView(settings, idps, emailDeliveryEnabled, requireEmailVerification) input
// tuples existed across those 16; three tests were exact duplicates of another test's call
// whose deep.equal already pinned the single field they checked, and were dropped:
//   • 'keeps allowEmailEntry when Zitadel policy allows email AND delivery is on'
//     — byte-identical call + assertion to the passwordless-org row below.
//   • 'signupUnavailable=false ... an IdP is present' — same call as the delivery-off row,
//     whose deep.equal already pins signupUnavailable: false.
//   • 'showPasskey=true with delivery' — same call as the passwordless-org row, whose
//     deep.equal already pins showPasskey: true.
// Every other assertion is preserved, and each row carries a label so a failure names the
// exact policy combination that broke.
import type { IdProvider, LoginSettings } from '@/modules/auth/types';
import { resolveSignupView } from '@/resources/signup/signup-view';

const base = {
  allowRegister: true,
  allowExternalIdp: true,
  allowPassword: false,
  passkeysType: 'allowed',
  disableLoginWithEmail: false,
} as unknown as LoginSettings;
const idps = [{ id: 'idp-g', name: 'Google', type: 'GOOGLE' }] as unknown as IdProvider[];

type View = ReturnType<typeof resolveSignupView>;
type Args = [LoginSettings, IdProvider[], boolean, boolean];

describe('resolveSignupView', () => {
  const FULL: [string, Args, View][] = [
    [
      'passwordless org: IdP buttons + email link + passkey, no password',
      [base, idps, true, true],
      {
        showIdpButtons: true,
        allowEmailEntry: true,
        showEmailLink: true,
        showPasskey: true,
        showPassword: false,
        signupUnavailable: false,
      },
    ],
    [
      'allowPassword on, no IdPs, passkeys off, registration off, delivery off',
      [
        {
          ...base,
          allowPassword: true,
          passkeysType: 'not_allowed',
          allowRegister: false,
        } as LoginSettings,
        [],
        false,
        true,
      ],
      {
        showIdpButtons: false,
        allowEmailEntry: false,
        showEmailLink: false,
        showPasskey: false,
        showPassword: true,
        signupUnavailable: true,
      },
    ],
    [
      // RED→GREEN: before the fix allowEmailEntry was true when delivery was off. With
      // delivery off the whole email path must hide so signup is IdP-only (no password
      // option and verification required — passkeys also need delivery).
      'delivery off hides the entire email path regardless of Zitadel policy',
      [base, idps, false, true],
      {
        showIdpButtons: true,
        allowEmailEntry: false,
        showEmailLink: false,
        showPasskey: false,
        showPassword: false,
        signupUnavailable: false,
      },
    ],
    [
      'disableLoginWithEmail hides email entry even with delivery on',
      [{ ...base, disableLoginWithEmail: true } as LoginSettings, idps, true, true],
      {
        showIdpButtons: true,
        allowEmailEntry: false,
        showEmailLink: false,
        showPasskey: true,
        showPassword: false,
        signupUnavailable: false,
      },
    ],
  ];

  // FULL and PARTIAL run in one test: both drive the same pure resolver, and a failure names
  // its own row, so splitting them bought no diagnostic value.

  const PARTIAL: [string, Args, Partial<View>][] = [
    // ── signupUnavailable edge cases ──────────────────────────────────────────────────
    [
      'allowRegister=false (policy disabled)',
      [{ ...base, allowRegister: false } as LoginSettings, idps, true, true],
      { signupUnavailable: true },
    ],
    [
      // Registration allowed by policy but no usable entry method on the index screen.
      // base has allowPassword:false + verification required → the password path would
      // strand on check-your-email even if shown, so allowEmailEntry stays false here.
      'allowRegister=true but no IdPs and delivery off (blank index)',
      [base, [], false, true],
      { signupUnavailable: true },
    ],
    [
      'email entry available even with no IdPs',
      [base, [], true, true],
      { signupUnavailable: false },
    ],
    // ── no-delivery password signup: allowEmailEntry without delivery ─────────────────
    [
      // RED: before the fix this returned false because delivery was off.
      // GREEN: password signup can skip verification, so email entry is safe to show —
      // but the emailed LINK still needs delivery and must stay hidden.
      'allowPassword=true + no verification required, delivery off',
      [{ ...base, allowPassword: true } as LoginSettings, [], false, false],
      { allowEmailEntry: true, showEmailLink: false },
    ],
    [
      'allowPassword=true + verification required, delivery off (would strand on check-your-email)',
      [{ ...base, allowPassword: true } as LoginSettings, [], false, true],
      { allowEmailEntry: false },
    ],
    [
      // base has allowPassword:false and passkeysType:'allowed' — even with verification
      // not required, no method can complete without delivery, so email entry stays
      // hidden. RED→GREEN for passkey: before the fix it was shown whenever
      // passkeysType==='allowed', ignoring that passkey signup also sends a verification
      // email and therefore requires delivery.
      'no password, delivery off (no non-delivery-gated method)',
      [base, [], false, false],
      { allowEmailEntry: false, showPasskey: false },
    ],
    [
      // allowEmailEntry is true in this case → signup is not unavailable.
      'password path viable with IdP off, delivery off',
      [
        { ...base, allowPassword: true, allowExternalIdp: false } as LoginSettings,
        [],
        false,
        false,
      ],
      { signupUnavailable: false },
    ],
  ];

  it('resolves the full view shape and individual flags across the policy/delivery matrix', () => {
    for (const [label, args, expected] of FULL) {
      expect(resolveSignupView(...args), label).to.deep.equal(expected);
    }

    for (const [label, args, expected] of PARTIAL) {
      const result = resolveSignupView(...args);
      for (const [field, value] of Object.entries(expected)) {
        expect(result[field as keyof View], `${label} → ${field}`).to.equal(value);
      }
    }
  });
});
