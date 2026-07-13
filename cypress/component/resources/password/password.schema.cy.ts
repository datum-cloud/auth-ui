// cypress/component/resources/password/password.schema.cy.ts
//
// Component (no-mount) port of app/resources/password/__tests__/password.schema.test.ts.
// Pure Zod schema validation → browser-side Chai only.
import { newPasswordSchema, resetRequestSchema } from '@/resources/password/password.schema';

describe('resetRequestSchema', () => {
  it('rejects an empty loginName', () => {
    const result = resetRequestSchema.safeParse({ loginName: '' });
    expect(result.success).to.equal(false);
  });
});

describe('newPasswordSchema', () => {
  it('rejects when passwords do not match', () => {
    const result = newPasswordSchema.safeParse({
      code: 'RESETCODE',
      userId: 'user-1',
      password: 'SuperSecret1!',
      confirm: 'DifferentPass2!',
    });
    expect(result.success).to.equal(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => (i.path as (string | number)[]).join('.'));
      expect(paths).to.include('confirm');
    }
  });
});
