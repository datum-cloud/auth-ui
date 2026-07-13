// cypress/component/resources/signup/signup-view.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup-view.test.ts.
// Pure view resolver → browser-side Chai only.
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

describe('resolveSignupView', () => {
  it('shows IdP buttons + email link + passkey, no password (passwordless org)', () => {
    expect(resolveSignupView(base, idps, true, true)).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: true,
      showEmailLink: true,
      showPasskey: true,
      showPassword: false,
      signupUnavailable: false,
    });
  });

  it('reflects allowPassword, missing IdPs, disabled passkeys, disabled registration, and disabled email delivery together', () => {
    expect(
      resolveSignupView(
        {
          ...base,
          allowPassword: true,
          passkeysType: 'not_allowed',
          allowRegister: false,
        } as LoginSettings,
        [],
        false,
        true
      )
    ).to.deep.equal({
      showIdpButtons: false,
      allowEmailEntry: false,
      showEmailLink: false,
      showPasskey: false,
      showPassword: true,
      signupUnavailable: true,
    });
  });

  it('hides email entry and link when emailDeliveryEnabled=false, regardless of Zitadel policy', () => {
    // RED→GREEN: before the fix allowEmailEntry was true when delivery was off.
    // With delivery off the whole email path must hide so signup is IdP-only
    // (when no password option or verification is required — passkeys also need delivery).
    expect(resolveSignupView(base, idps, false, true)).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: false,
      showEmailLink: false,
      // passkey hides without delivery (passkey signup also sends a verification email)
      showPasskey: false,
      showPassword: false,
      signupUnavailable: false,
    });
  });

  it('keeps allowEmailEntry when Zitadel policy allows email AND delivery is on', () => {
    expect(resolveSignupView(base, idps, true, true)).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: true,
      showEmailLink: true,
      showPasskey: true,
      showPassword: false,
      signupUnavailable: false,
    });
  });

  it('hides email entry when Zitadel disableLoginWithEmail=true even if delivery is on', () => {
    expect(
      resolveSignupView({ ...base, disableLoginWithEmail: true } as LoginSettings, idps, true, true)
    ).to.deep.equal({
      showIdpButtons: true,
      allowEmailEntry: false,
      showEmailLink: false,
      showPasskey: true,
      showPassword: false,
      signupUnavailable: false,
    });
  });

  // --- signupUnavailable edge-case coverage ---

  it('signupUnavailable=true when allowRegister=false (policy disabled)', () => {
    const result = resolveSignupView(
      { ...base, allowRegister: false } as LoginSettings,
      idps,
      true,
      true
    );
    expect(result.signupUnavailable).to.equal(true);
  });

  it('signupUnavailable=true when allowRegister=true but no IdPs and email delivery off (blank index)', () => {
    // Registration allowed by policy but no usable entry method on the index screen.
    // base has allowPassword:false, requireEmailVerification:true → password path would
    // strand on check-your-email even if shown, so allowEmailEntry stays false here.
    const result = resolveSignupView(base, [], false, true);
    expect(result.signupUnavailable).to.equal(true);
  });

  it('signupUnavailable=false when allowRegister=true and an IdP is present (even if email delivery off)', () => {
    const result = resolveSignupView(base, idps, false, true);
    expect(result.signupUnavailable).to.equal(false);
  });

  it('signupUnavailable=false when allowRegister=true and email entry is available (even if no IdPs)', () => {
    const result = resolveSignupView(base, [], true, true);
    expect(result.signupUnavailable).to.equal(false);
  });

  // ── Task 2: no-delivery password signup — allowEmailEntry without delivery ──────────────────

  it('allowEmailEntry=true without delivery when allowPassword=true AND requireEmailVerification=false', () => {
    // RED: before the fix this returned false because delivery was off.
    // GREEN: password signup can skip verification, so email entry is safe to show.
    const settings = { ...base, allowPassword: true } as LoginSettings;
    const result = resolveSignupView(settings, [], false, false);
    expect(result.allowEmailEntry).to.equal(true);
  });

  it('allowEmailEntry=false without delivery when requireEmailVerification=true (would strand on check-your-email)', () => {
    const settings = { ...base, allowPassword: true } as LoginSettings;
    const result = resolveSignupView(settings, [], false, true);
    expect(result.allowEmailEntry).to.equal(false);
  });

  it('allowEmailEntry=false without delivery when allowPassword=false (no non-delivery-gated method)', () => {
    // base has allowPassword:false — even with requireEmailVerification=false, no method
    // can complete without delivery, so email entry must stay hidden.
    const result = resolveSignupView(base, [], false, false);
    expect(result.allowEmailEntry).to.equal(false);
  });

  it('showEmailLink=false without delivery even when allowEmailEntry=true (link needs delivery)', () => {
    const settings = { ...base, allowPassword: true } as LoginSettings;
    const result = resolveSignupView(settings, [], false, false);
    expect(result.showEmailLink).to.equal(false);
  });

  it('showPasskey=false without delivery even when passkeysType=allowed (passkey signup sends verification email)', () => {
    // RED: before the fix passkey was shown whenever passkeysType==='allowed'.
    // GREEN: passkey signup also triggers an email verification step, so it requires delivery.
    const settings = { ...base, passkeysType: 'allowed' } as LoginSettings;
    const result = resolveSignupView(settings, [], false, false);
    expect(result.showPasskey).to.equal(false);
  });

  it('showPasskey=true with delivery when passkeysType=allowed', () => {
    const result = resolveSignupView(base, idps, true, true);
    expect(result.showPasskey).to.equal(true);
  });

  it('signupUnavailable=false when no-delivery + allowPassword=true + requireEmailVerification=false (password path is viable)', () => {
    // allowEmailEntry is true in this case → signup is not unavailable
    const settings = { ...base, allowPassword: true, allowExternalIdp: false } as LoginSettings;
    const result = resolveSignupView(settings, [], false, false);
    expect(result.signupUnavailable).to.equal(false);
  });
});
