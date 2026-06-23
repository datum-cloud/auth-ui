import { withPasswordMatch } from '../password-match';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const schema = withPasswordMatch(z.object({ password: z.string(), confirmPassword: z.string() }), {
  confirmField: 'confirmPassword',
});

describe('withPasswordMatch', () => {
  it('passes when passwords match', () => {
    expect(schema.safeParse({ password: 'a', confirmPassword: 'a' }).success).toBe(true);
  });
  it('fails when passwords differ, error on confirmPassword path', () => {
    const r = schema.safeParse({ password: 'a', confirmPassword: 'b' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toContain('confirmPassword');
    }
  });
  it('defaults to the real confirm field name used by the live schemas', () => {
    const real = withPasswordMatch(z.object({ password: z.string(), confirm: z.string() }));
    const ok = real.safeParse({ password: 'a', confirm: 'a' });
    expect(ok.success).toBe(true);
    const bad = real.safeParse({ password: 'a', confirm: 'b' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0].path).toContain('confirm');
      expect(bad.error.issues[0].message).toBe('Passwords must match');
    }
  });
});
