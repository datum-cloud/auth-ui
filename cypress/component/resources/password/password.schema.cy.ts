// cypress/component/resources/password/password.schema.cy.ts
//
// Component (no-mount) port of app/resources/password/__tests__/password.schema.test.ts.
// Pure Zod schema validation → browser-side Chai only.
import {
  resetRequestSchema,
  newPasswordSchema,
  changePasswordSchema,
} from '@/resources/password/password.schema';

describe('resetRequestSchema', () => {
  it('accepts a valid loginName', () => {
    const result = resetRequestSchema.safeParse({ loginName: 'user@example.com' });
    expect(result.success).to.equal(true);
  });

  it('rejects an empty loginName', () => {
    const result = resetRequestSchema.safeParse({ loginName: '' });
    expect(result.success).to.equal(false);
  });

  it('accepts optional organization and requestId', () => {
    const result = resetRequestSchema.safeParse({
      loginName: 'user@example.com',
      organization: 'org-123',
      requestId: 'oidc_abc',
    });
    expect(result.success).to.equal(true);
  });
});

describe('newPasswordSchema', () => {
  it('accepts valid code, userId, and matching passwords', () => {
    const result = newPasswordSchema.safeParse({
      code: 'RESETCODE',
      userId: 'user-1',
      password: 'SuperSecret1!',
      confirm: 'SuperSecret1!',
    });
    expect(result.success).to.equal(true);
  });

  it('rejects when code is missing', () => {
    const result = newPasswordSchema.safeParse({
      code: '',
      userId: 'user-1',
      password: 'SuperSecret1!',
      confirm: 'SuperSecret1!',
    });
    expect(result.success).to.equal(false);
  });

  it('rejects when userId is missing', () => {
    const result = newPasswordSchema.safeParse({
      code: 'RESETCODE',
      userId: '',
      password: 'SuperSecret1!',
      confirm: 'SuperSecret1!',
    });
    expect(result.success).to.equal(false);
  });

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

  it('rejects password shorter than 8 characters', () => {
    const result = newPasswordSchema.safeParse({
      code: 'RESETCODE',
      userId: 'user-1',
      password: 'short',
      confirm: 'short',
    });
    expect(result.success).to.equal(false);
  });
});

describe('changePasswordSchema', () => {
  it('accepts matching passwords with a sessionId', () => {
    const result = changePasswordSchema.safeParse({
      sessionId: 'sess1',
      password: 'Secret123',
      confirm: 'Secret123',
    });
    expect(result.success).to.equal(true);
  });

  it('rejects mismatched confirm', () => {
    const result = changePasswordSchema.safeParse({
      sessionId: 'sess1',
      password: 'Secret123',
      confirm: 'Different1',
    });
    expect(result.success).to.equal(false);
    if (!result.success) {
      expect(result.error.issues[0].path).to.include('confirm');
    }
  });

  it('rejects password shorter than 8 characters', () => {
    const result = changePasswordSchema.safeParse({
      sessionId: 'sess1',
      password: 'short',
      confirm: 'short',
    });
    expect(result.success).to.equal(false);
  });
});
