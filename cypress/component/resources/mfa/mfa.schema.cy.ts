// cypress/component/resources/mfa/mfa.schema.cy.ts
//
// Component (no-mount) port of app/resources/mfa/__tests__/mfa.schema.test.ts.
// Pure Zod schemas → browser-side Chai. KEPT (not pruned) because otpCodeSchema's strict-6-digit
// rule is a SECURITY regression guard: widening it would weaken TOTP. (This invariant is not
// exercised by any e2e flow.)
import { otpCodeSchema } from '@/resources/mfa/mfa.schema';

// TOTP/authenticator codes MUST stay exactly 6 digits — both too-short and too-long inputs
// are rejected. Widening this schema in either direction would weaken TOTP.
const CASES: [code: string, accepted: boolean][] = [
  ['123456', true],
  ['abc', false],
  ['12', false],
  ['1234567', false],
  ['86230120', false],
];

describe('mfa schemas', () => {
  it('accepts exactly a 6-digit OTP code and rejects non-numeric, short, and 7/8-digit codes (TOTP regression guard)', () => {
    for (const [code, accepted] of CASES) {
      expect(otpCodeSchema.safeParse({ code }).success, `code=${code}`).to.equal(accepted);
    }
  });
});
