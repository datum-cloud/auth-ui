import { verifyCodeSchema, changePasswordSchema } from './verify';
import { describe, it, expect } from 'vitest';

describe('verifyCodeSchema', () => {
  it('accepts userId and code at minimum', () => {
    const result = verifyCodeSchema.safeParse({ userId: 'u1', code: '123456' });
    expect(result.success).toBe(true);
  });

  it('accepts optional invite flag', () => {
    const result = verifyCodeSchema.safeParse({ userId: 'u1', code: '123456', invite: 'true' });
    expect(result.success).toBe(true);
  });

  it('rejects missing userId', () => {
    const result = verifyCodeSchema.safeParse({ code: '123456' });
    expect(result.success).toBe(false);
  });

  it('rejects missing code', () => {
    const result = verifyCodeSchema.safeParse({ userId: 'u1' });
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
