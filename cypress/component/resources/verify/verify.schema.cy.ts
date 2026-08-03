// cypress/component/resources/verify/verify.schema.cy.ts
//
// Component (no-mount) port of app/resources/verify/__tests__/verify.schema.test.ts.
// Zod verify code schema → browser-side Chai only.
import { verifyCodeSchema } from '@/resources/verify/verify.schema';

const CASES: [label: string, input: Record<string, string>, accepted: boolean][] = [
  ['userId + code (the minimum)', { userId: 'u1', code: '123456' }, true],
  ['missing code', { userId: 'u1' }, false],
];

describe('verifyCodeSchema', () => {
  it('accepts userId and code at minimum, rejecting input with the code missing', () => {
    for (const [label, input, accepted] of CASES) {
      expect(verifyCodeSchema.safeParse(input).success, label).to.equal(accepted);
    }
  });
});
