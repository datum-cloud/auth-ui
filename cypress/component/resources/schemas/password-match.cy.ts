// cypress/component/resources/schemas/password-match.cy.ts
//
// Component (no-mount) port of app/resources/schemas/__tests__/password-match.test.ts.
// Pure Zod superRefine helper → browser-side Chai only.
import { withPasswordMatch } from '@/resources/schemas/password-match';
import { z } from 'zod';

const schema = withPasswordMatch(z.object({ password: z.string(), confirmPassword: z.string() }), {
  confirmField: 'confirmPassword',
});

describe('withPasswordMatch', () => {
  it('passes when passwords match', () => {
    expect(schema.safeParse({ password: 'a', confirmPassword: 'a' }).success).to.equal(true);
  });

  it('fails when passwords differ, error on confirmPassword path', () => {
    const r = schema.safeParse({ password: 'a', confirmPassword: 'b' });
    expect(r.success).to.equal(false);
    if (!r.success) {
      expect(r.error.issues[0].path).to.include('confirmPassword');
    }
  });

  it('defaults to the real confirm field name used by the live schemas', () => {
    const real = withPasswordMatch(z.object({ password: z.string(), confirm: z.string() }));
    const ok = real.safeParse({ password: 'a', confirm: 'a' });
    expect(ok.success).to.equal(true);
    const bad = real.safeParse({ password: 'a', confirm: 'b' });
    expect(bad.success).to.equal(false);
    if (!bad.success) {
      expect(bad.error.issues[0].path).to.include('confirm');
      expect(bad.error.issues[0].message).to.equal('Passwords must match');
    }
  });
});
