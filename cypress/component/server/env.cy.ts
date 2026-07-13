// cypress/component/server/env.cy.ts
// COMPONENT port of app/server/__tests__/env.test.ts
// Pure function: requireEmailVerification takes a plain Record — no node deps.
import { requireEmailVerification } from '@/server/env';

describe('requireEmailVerification', () => {
  it('defaults to false when EMAIL_VERIFICATION is unset (opt-in)', () => {
    expect(requireEmailVerification({})).to.equal(false);
  });

  it('returns false when EMAIL_VERIFICATION is explicitly "false"', () => {
    expect(requireEmailVerification({ EMAIL_VERIFICATION: 'false' })).to.equal(false);
  });

  it('returns true only when EMAIL_VERIFICATION is exactly "true"', () => {
    expect(requireEmailVerification({ EMAIL_VERIFICATION: 'true' })).to.equal(true);
  });
});
