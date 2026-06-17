import { resetRequestSchema, newPasswordSchema, changePasswordSchema } from '../password.schema';
import { describe, it, expect } from 'vitest';

describe('resetRequestSchema', () => {
  it('accepts a valid loginName', () => {
    const result = resetRequestSchema.safeParse({ loginName: 'user@example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty loginName', () => {
    const result = resetRequestSchema.safeParse({ loginName: '' });
    expect(result.success).toBe(false);
  });

  it('accepts optional organization and requestId', () => {
    const result = resetRequestSchema.safeParse({
      loginName: 'user@example.com',
      organization: 'org-123',
      requestId: 'oidc_abc',
    });
    expect(result.success).toBe(true);
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
    expect(result.success).toBe(true);
  });

  it('rejects when code is missing', () => {
    const result = newPasswordSchema.safeParse({
      code: '',
      userId: 'user-1',
      password: 'SuperSecret1!',
      confirm: 'SuperSecret1!',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when userId is missing', () => {
    const result = newPasswordSchema.safeParse({
      code: 'RESETCODE',
      userId: '',
      password: 'SuperSecret1!',
      confirm: 'SuperSecret1!',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when passwords do not match', () => {
    const result = newPasswordSchema.safeParse({
      code: 'RESETCODE',
      userId: 'user-1',
      password: 'SuperSecret1!',
      confirm: 'DifferentPass2!',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('confirm');
    }
  });

  it('rejects password shorter than 8 characters', () => {
    const result = newPasswordSchema.safeParse({
      code: 'RESETCODE',
      userId: 'user-1',
      password: 'short',
      confirm: 'short',
    });
    expect(result.success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('accepts matching passwords with a sessionId', () => {
    const result = changePasswordSchema.safeParse({
      sessionId: 'sess1',
      password: 'Secret123',
      confirm: 'Secret123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects mismatched confirm', () => {
    const result = changePasswordSchema.safeParse({
      sessionId: 'sess1',
      password: 'Secret123',
      confirm: 'Different1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('confirm');
    }
  });

  it('rejects password shorter than 8 characters', () => {
    const result = changePasswordSchema.safeParse({
      sessionId: 'sess1',
      password: 'short',
      confirm: 'short',
    });
    expect(result.success).toBe(false);
  });
});
