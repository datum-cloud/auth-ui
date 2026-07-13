// cypress/component/resources/signup/signup.schema.identifier.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup.schema.identifier.test.ts.
// Zod identifier + method schemas → browser-side Chai only.
import { signupIdentifierSchema, signupMethodSchema } from '@/resources/signup/signup.schema';

describe('signup identifier & method schemas', () => {
  it('validates a proper email identifier and a known method intent, rejecting invalid variants', () => {
    expect(signupIdentifierSchema.safeParse({ email: 'a@b.com' }).success).to.equal(true);
    expect(signupIdentifierSchema.safeParse({ email: 'nope' }).success).to.equal(false);

    expect(
      signupMethodSchema.safeParse({
        intent: 'email-link',
        loginName: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
      }).success
    ).to.equal(true);
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
