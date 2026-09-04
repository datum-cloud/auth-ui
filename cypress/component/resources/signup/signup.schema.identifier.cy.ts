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
        intent: 'passkey',
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

    // Signup is passkey-only. The two RETIRED intents must fail at the parse boundary, so a
    // hand-crafted POST (or a form cached from before the screen changed) cannot reach a branch
    // the UI no longer offers — this is the server-side half of hiding those buttons.
    for (const intent of ['email-link', 'password']) {
      expect(
        signupMethodSchema.safeParse({
          intent,
          loginName: 'a@b.com',
          firstName: 'A',
          lastName: 'B',
        }).success,
        `retired intent ${intent} must be rejected`
      ).to.equal(false);
    }
  });
});
