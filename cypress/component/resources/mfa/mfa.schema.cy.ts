// cypress/component/resources/mfa/mfa.schema.cy.ts
//
// Component (no-mount) port of app/resources/mfa/__tests__/mfa.schema.test.ts.
// Pure Zod schemas → browser-side Chai. KEPT (not pruned) because otpCodeSchema's strict-6-digit
// rule is a SECURITY regression guard: widening it would weaken TOTP, and the email/SMS delivery
// schema must stay 6–8. (These invariants are not exercised by any e2e flow.)
import {
  otpCodeSchema,
  otpDeliveryCodeSchema,
  mfaMethodSchema,
  secondFactorMethodSchema,
} from '@/resources/mfa/mfa.schema';

describe('mfa schemas', () => {
  it('accepts a 6-digit OTP code and rejects others', () => {
    expect(otpCodeSchema.safeParse({ code: '123456' }).success).to.equal(true);
    expect(otpCodeSchema.safeParse({ code: 'abc' }).success).to.equal(false);
    expect(otpCodeSchema.safeParse({ code: '12' }).success).to.equal(false);
  });

  it('keeps otpCodeSchema strictly 6 digits — rejects 8-digit codes (TOTP regression guard)', () => {
    // TOTP/authenticator codes MUST stay exactly 6 digits; widening here would weaken TOTP.
    expect(otpCodeSchema.safeParse({ code: '86230120' }).success).to.equal(false);
    expect(otpCodeSchema.safeParse({ code: '1234567' }).success).to.equal(false);
  });

  it('otpDeliveryCodeSchema accepts both 6- and 8-digit codes (email/SMS delivery)', () => {
    expect(otpDeliveryCodeSchema.safeParse({ code: '123456' }).success).to.equal(true);
    expect(otpDeliveryCodeSchema.safeParse({ code: '86230120' }).success).to.equal(true);
  });

  it('otpDeliveryCodeSchema rejects non-numeric and out-of-range lengths', () => {
    expect(otpDeliveryCodeSchema.safeParse({ code: 'abc' }).success).to.equal(false);
    expect(otpDeliveryCodeSchema.safeParse({ code: '12345' }).success).to.equal(false);
    expect(otpDeliveryCodeSchema.safeParse({ code: '123456789' }).success).to.equal(false);
  });

  it('accepts a known MFA method and rejects unknown', () => {
    expect(mfaMethodSchema.safeParse({ method: 'totp' }).success).to.equal(true);
    expect(mfaMethodSchema.safeParse({ method: 'carrier-pigeon' }).success).to.equal(false);
  });

  it('accepts a second-factor method and rejects passkey', () => {
    expect(secondFactorMethodSchema.safeParse({ method: 'totp' }).success).to.equal(true);
    expect(secondFactorMethodSchema.safeParse({ method: 'passkey' }).success).to.equal(false);
    expect(secondFactorMethodSchema.safeParse({ method: 'unknown' }).success).to.equal(false);
  });
});
