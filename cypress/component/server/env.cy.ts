// cypress/component/server/env.cy.ts
// COMPONENT port of app/server/__tests__/env.test.ts
// Pure function: requireEmailVerification takes a plain Record — no node deps.
import { requireEmailVerification } from '@/server/env';

// Opt-in by default: only the exact string 'true' enables verification.
const CASES: [label: string, env: Record<string, string>, expected: boolean][] = [
  ['unset (opt-in default)', {}, false],
  ['explicitly "false"', { EMAIL_VERIFICATION: 'false' }, false],
  ['exactly "true"', { EMAIL_VERIFICATION: 'true' }, true],
];

describe('requireEmailVerification', () => {
  it('defaults to false and returns true only when EMAIL_VERIFICATION is exactly "true"', () => {
    for (const [label, env, expected] of CASES) {
      expect(requireEmailVerification(env), label).to.equal(expected);
    }
  });
});
