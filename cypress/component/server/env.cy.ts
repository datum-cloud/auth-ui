// cypress/component/server/env.cy.ts
// COMPONENT port of app/server/__tests__/env.test.ts
// Pure function: requireEmailVerification takes a plain Record — no node deps.
import { requireEmailVerification } from '@/server/env';

describe('requireEmailVerification', () => {
  it('defaults to true when EMAIL_VERIFICATION is unset', () => {
    expect(requireEmailVerification({})).to.equal(true);
  });

  it('returns false only when EMAIL_VERIFICATION is exactly "false"', () => {
    expect(requireEmailVerification({ EMAIL_VERIFICATION: 'false' })).to.equal(false);
  });
});
