// cypress/component/resources/signup/signup.schema.identifier.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup.schema.identifier.test.ts.
// Zod identifier + method schemas → browser-side Chai only.
import { signupIdentifierSchema, signupMethodSchema } from '@/resources/signup/signup.schema';

describe('signupIdentifierSchema', () => {
  it('accepts a valid email', () => {
    expect(signupIdentifierSchema.safeParse({ email: 'a@b.com' }).success).to.equal(true);
  });
  it('rejects a non-email', () => {
    expect(signupIdentifierSchema.safeParse({ email: 'nope' }).success).to.equal(false);
  });
});

describe('signupMethodSchema', () => {
  it('accepts a valid method intent', () => {
    expect(
      signupMethodSchema.safeParse({
        intent: 'email-link',
        loginName: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
      }).success
    ).to.equal(true);
  });
  it('rejects an unknown intent', () => {
    expect(
      signupMethodSchema.safeParse({
        intent: 'sms',
        loginName: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
      }).success
    ).to.equal(false);
  });
});
