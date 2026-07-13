// cypress/component/resources/mfa/mfa.schema.cy.ts
//
// Component (no-mount) port of app/resources/mfa/__tests__/mfa.schema.test.ts.
// Pure Zod schemas → browser-side Chai. KEPT (not pruned) because otpCodeSchema's strict-6-digit
// rule is a SECURITY regression guard: widening it would weaken TOTP. (This invariant is not
// exercised by any e2e flow.)
import { otpCodeSchema } from '@/resources/mfa/mfa.schema';

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
});
