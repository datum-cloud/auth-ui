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
  it('reports a password mismatch on the confirm path, for an explicit and the default field', () => {
    // Explicit confirmField override.
    const explicit = schema.safeParse({ password: 'a', confirmPassword: 'b' });
    expect(explicit.success, 'explicit confirmField: mismatch rejected').to.equal(false);
    if (!explicit.success) {
      expect(explicit.error.issues[0].path, 'explicit confirmField: error path').to.include(
        'confirmPassword'
      );
    }

    // Default confirm field name.
    const real = withPasswordMatch(z.object({ password: z.string(), confirm: z.string() }));
    const ok = real.safeParse({ password: 'a', confirm: 'a' });
    expect(ok.success, 'default confirm: match accepted').to.equal(true);
    const bad = real.safeParse({ password: 'a', confirm: 'b' });
    expect(bad.success, 'default confirm: mismatch rejected').to.equal(false);
    if (!bad.success) {
      expect(bad.error.issues[0].path, 'default confirm: error path').to.include('confirm');
      expect(bad.error.issues[0].message, 'default confirm: message').to.equal(
        'Passwords must match'
      );
    }
  });
});
