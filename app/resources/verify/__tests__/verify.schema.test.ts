import { verifyCodeSchema } from '../verify.schema';
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
