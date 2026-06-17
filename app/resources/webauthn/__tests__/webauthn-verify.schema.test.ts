import { webauthnAssertionSchema } from '../webauthn-verify';
import { describe, it, expect } from 'vitest';

describe('webauthnAssertionSchema (CODE-MIN-11)', () => {
  it('validates the four-field assertion form', () => {
    const ok = webauthnAssertionSchema.safeParse({ credential: 'x', loginName: 'a@b.c' });
    expect(ok.success).toBe(true);
  });
  it('rejects a missing credential', () => {
    expect(webauthnAssertionSchema.safeParse({ loginName: 'a@b.c' }).success).toBe(false);
  });
});
