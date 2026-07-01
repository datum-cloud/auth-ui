// cypress/component/resources/schemas/password-complexity.cy.ts
//
// Pure (no-mount) tests for the org password-complexity policy → the shared rule
// list + Zod field builder both the password forms and their schemas are driven by.
// The provider capability getPasswordComplexity(orgId?) yields this policy; here we
// assert the derived validation/UX is POLICY-DRIVEN (not the old hardcoded min(8)).
import type { PasswordComplexity } from '@/modules/auth/types';
import {
  DEFAULT_PASSWORD_COMPLEXITY,
  passwordComplexityField,
  passwordRules,
} from '@/resources/schemas/password-complexity';

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

  it('adds a rule per required character class, in a stable order', () => {
    const rules = passwordRules(
      policy({
        requiresUppercase: true,
        requiresLowercase: true,
        requiresNumber: true,
        requiresSymbol: true,
      })
    );
    expect(rules.map((r) => r.id)).to.deep.equal([
      'minLength',
      'uppercase',
      'lowercase',
      'number',
      'symbol',
    ]);
  });

  it('drives the min-length requirement text from the policy minLength', () => {
    const rule = passwordRules(policy({ minLength: 12 }))[0];
    expect(rule.requirement).to.contain('12');
    expect(rule.test('a'.repeat(11))).to.equal(false);
    expect(rule.test('a'.repeat(12))).to.equal(true);
  });

  it('each rule.test reflects the class it guards', () => {
    const rules = passwordRules(
      policy({ requiresUppercase: true, requiresNumber: true, requiresSymbol: true })
    );
    const byId = Object.fromEntries(rules.map((r) => [r.id, r]));
    expect(byId.uppercase.test('lower')).to.equal(false);
    expect(byId.uppercase.test('Upper')).to.equal(true);
    expect(byId.number.test('nodigits')).to.equal(false);
    expect(byId.number.test('has1digit')).to.equal(true);
    expect(byId.symbol.test('nosymbol1')).to.equal(false);
    expect(byId.symbol.test('has!symbol')).to.equal(true);
  });

  it('falls back to the default policy (min 8, no classes) when policy is undefined', () => {
    const rules = passwordRules(undefined);
    expect(rules.map((r) => r.id)).to.deep.equal(['minLength']);
    expect(DEFAULT_PASSWORD_COMPLEXITY.minLength).to.equal(8);
  });
});

describe('passwordComplexityField — Zod validation derived from the policy', () => {
  it('minLength drives the length check', () => {
    const field = passwordComplexityField(policy({ minLength: 10 }));
    expect(field.safeParse('short').success).to.equal(false);
    expect(field.safeParse('longenough').success).to.equal(true);
  });

  it('a policy requiring a symbol REJECTS a symbol-less password', () => {
    const field = passwordComplexityField(policy({ requiresSymbol: true }));
    expect(field.safeParse('NoSymbolHere1').success).to.equal(false);
    expect(field.safeParse('HasASymbol!1').success).to.equal(true);
  });

  it('a policy NOT requiring uppercase ACCEPTS a lowercase-only password', () => {
    const field = passwordComplexityField(policy({ requiresUppercase: false }));
    expect(field.safeParse('alllowercase').success).to.equal(true);
  });

  it('a policy requiring uppercase REJECTS a lowercase-only password', () => {
    const field = passwordComplexityField(policy({ requiresUppercase: true }));
    expect(field.safeParse('alllowercase').success).to.equal(false);
    expect(field.safeParse('HasUppercase').success).to.equal(true);
  });

  it('surfaces a distinct message per unmet rule', () => {
    const field = passwordComplexityField(policy({ minLength: 12, requiresSymbol: true }));
    const result = field.safeParse('short');
    expect(result.success).to.equal(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).to.include('Password is too short');
      expect(messages).to.include('Password must contain a symbol');
    }
  });
});
