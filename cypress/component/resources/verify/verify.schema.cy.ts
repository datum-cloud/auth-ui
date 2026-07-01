// cypress/component/resources/verify/verify.schema.cy.ts
//
// Component (no-mount) port of app/resources/verify/__tests__/verify.schema.test.ts.
// Zod verify code schema → browser-side Chai only.
import { verifyCodeSchema } from '@/resources/verify/verify.schema';

describe('verifyCodeSchema', () => {
  it('accepts userId and code at minimum', () => {
    const result = verifyCodeSchema.safeParse({ userId: 'u1', code: '123456' });
    expect(result.success).to.equal(true);
  });

  it('rejects missing code', () => {
    const result = verifyCodeSchema.safeParse({ userId: 'u1' });
    expect(result.success).to.equal(false);
  });
});
