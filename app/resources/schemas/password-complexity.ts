// app/resources/schemas/password-complexity.ts
//
// The single source of truth for the ORG password-complexity policy in the UI layer.
// The provider capability `getPasswordComplexity(orgId?)` returns a `PasswordComplexity`
// (min length + which character classes are required); this module derives BOTH:
//   • `passwordRules(policy)`      → the live requirement checklist the forms render, and
//   • `passwordComplexityField()`  → the Zod validator the client + server schemas use.
// Deriving both from one `passwordRules` list keeps the checklist and the validation in
// lock-step, and makes the previously-hardcoded `min(8)`/symbol rules POLICY-DRIVEN.
//
// Browser-safe: imports only Zod + the `PasswordComplexity` type — never a `.server` module —
// so the client bundle (form components) and the server actions can both import it.
import type { PasswordComplexity } from '@/modules/auth/types';
import { z } from 'zod';

/** Fallback minimum when the policy omits (or zeroes) `minLength`. Mirrors the old hardcoded rule. */
export const DEFAULT_MIN_LENGTH = 8;

/**
 * The policy assumed when the provider omits the complexity block (getPasswordComplexity →
 * undefined): the old behaviour — a minimum length, no required character classes.
 */
export const DEFAULT_PASSWORD_COMPLEXITY: PasswordComplexity = {
  minLength: DEFAULT_MIN_LENGTH,
  requiresUppercase: false,
  requiresLowercase: false,
  requiresNumber: false,
  requiresSymbol: false,
};

export type PasswordRuleId = 'minLength' | 'uppercase' | 'lowercase' | 'number' | 'symbol';

export interface PasswordRule {
  id: PasswordRuleId;
  /** Positive requirement text for the live checklist (e.g. "At least 12 characters"). */
  requirement: string;
  /** Validation-failure message (matches the old app's copy) surfaced by the Zod field. */
  message: string;
  /** Predicate: does `value` satisfy this rule? Drives both the checklist tick and the Zod issue. */
  test: (value: string) => boolean;
}

const UPPERCASE = /[A-Z]/;
const LOWERCASE = /[a-z]/;
const NUMBER = /[0-9]/;
// A symbol is any non-alphanumeric character (mirrors Zitadel's hasSymbol check).
const SYMBOL = /[^A-Za-z0-9]/;

/**
 * Derive the ordered requirement list from the policy: always the min-length rule, then one
 * rule per required character class. `policy` undefined → the default (min length, no classes).
 * A zero/absent `minLength` falls back to `DEFAULT_MIN_LENGTH`.
 */
export function passwordRules(policy: PasswordComplexity | undefined): PasswordRule[] {
  const resolved = policy ?? DEFAULT_PASSWORD_COMPLEXITY;
  const minLength = resolved.minLength > 0 ? resolved.minLength : DEFAULT_MIN_LENGTH;

  const rules: PasswordRule[] = [
    {
      id: 'minLength',
      requirement: `At least ${minLength} characters`,
      message: 'Password is too short',
      test: (value) => value.length >= minLength,
    },
  ];

  if (resolved.requiresUppercase) {
    rules.push({
      id: 'uppercase',
      requirement: 'An uppercase letter',
      message: 'Password must contain an uppercase letter',
      test: (value) => UPPERCASE.test(value),
    });
  }
  if (resolved.requiresLowercase) {
    rules.push({
      id: 'lowercase',
      requirement: 'A lowercase letter',
      message: 'Password must contain a lowercase letter',
      test: (value) => LOWERCASE.test(value),
    });
  }
  if (resolved.requiresNumber) {
    rules.push({
      id: 'number',
      requirement: 'A number',
      message: 'Password must contain a number',
      test: (value) => NUMBER.test(value),
    });
  }
  if (resolved.requiresSymbol) {
    rules.push({
      id: 'symbol',
      requirement: 'A symbol',
      message: 'Password must contain a symbol',
      test: (value) => SYMBOL.test(value),
    });
  }

  return rules;
}

/**
 * Build the Zod validator for a password field from the policy. Every unmet rule emits its own
 * issue (so the caller can surface all failures at once), using the same predicates the checklist
 * ticks off — the validation can never drift from the displayed requirements.
 */
export function passwordComplexityField(policy: PasswordComplexity | undefined): z.ZodType<string> {
  const rules = passwordRules(policy);
  return z.string().superRefine((value, ctx) => {
    for (const rule of rules) {
      if (!rule.test(value)) {
        ctx.addIssue({ code: 'custom', message: rule.message });
      }
    }
  });
}
