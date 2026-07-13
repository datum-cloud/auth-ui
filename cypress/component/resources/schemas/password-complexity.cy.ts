// cypress/component/resources/schemas/password-complexity.cy.ts
//
// Pure (no-mount) tests for the org password-complexity policy → the shared rule
// list + Zod field builder both the password forms and their schemas are driven by.
// The provider capability getPasswordComplexity(orgId?) yields this policy; here we
// assert the derived validation/UX is POLICY-DRIVEN (not the old hardcoded min(8)).
import type { PasswordComplexity } from '@/modules/auth/types';
import { passwordComplexityField, passwordRules } from '@/resources/schemas/password-complexity';

const policy = (overrides: Partial<PasswordComplexity> = {}): PasswordComplexity => ({
  minLength: 8,
  requiresUppercase: false,
  requiresLowercase: false,
  requiresNumber: false,
  requiresSymbol: false,
  ...overrides,
});

describe('passwordRules — checklist derived from the policy', () => {
  it('lists ONLY min-length when the policy requires no character classes', () => {
    const rules = passwordRules(policy());
    expect(rules.map((r) => r.id)).to.deep.equal(['minLength']);
  });
});

describe('passwordComplexityField — Zod validation derived from the policy', () => {
  it('a policy requiring a symbol REJECTS a symbol-less password', () => {
    const field = passwordComplexityField(policy({ requiresSymbol: true }));
    expect(field.safeParse('NoSymbolHere1').success).to.equal(false);
    expect(field.safeParse('HasASymbol!1').success).to.equal(true);
  });
});
