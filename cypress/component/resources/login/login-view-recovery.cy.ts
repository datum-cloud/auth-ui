// cypress/component/resources/login/login-view-recovery.cy.ts
//
// resolveLoginView's recovery link. Pure — no I/O — so it is asserted directly.
//
// The link is gated on TWO facts, not one: the flag AND the org actually allowing passkeys.
// Offering recovery to an org whose settings say `passkeysType: not_allowed` would send the user
// down a flow requestRecovery refuses at the end, and the refusal is silent by design (G7) — so
// they would sit at "check your email" waiting for mail that is never coming.
import type { LoginSettings } from '@/modules/auth/types';
import { resolveLoginView } from '@/resources/login/login-view';

const settings = (over: Partial<LoginSettings> = {}) =>
  ({
    allowPassword: true,
    allowRegister: true,
    allowExternalIdp: false,
    passkeysType: 'allowed',
    disableLoginWithEmail: false,
    ...over,
  }) as LoginSettings;

describe('resolveLoginView — showRecoveryLink', () => {
  it('is false when the flag is off, even for a passkey org', () => {
    expect(resolveLoginView(settings(), [], true, false).showRecoveryLink).to.equal(false);
  });

  it('defaults to false when the caller passes no flag at all', () => {
    expect(resolveLoginView(settings(), [], true).showRecoveryLink).to.equal(false);
  });

  it('is true only with the flag AND an org that allows passkeys', () => {
    expect(resolveLoginView(settings(), [], true, true).showRecoveryLink).to.equal(true);
    expect(
      resolveLoginView(settings({ passkeysType: 'not_allowed' }), [], true, true).showRecoveryLink
    ).to.equal(false);
  });
});
