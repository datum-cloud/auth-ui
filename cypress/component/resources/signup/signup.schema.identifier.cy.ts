// cypress/component/resources/signup/signup.schema.identifier.cy.ts
//
// Component (no-mount) port of app/resources/signup/__tests__/signup.schema.identifier.test.ts.
// Zod identifier + method schemas → browser-side Chai only.
import { signupIdentifierSchema, signupMethodSchema } from '@/resources/signup/signup.schema';

describe('signup identifier & method schemas', () => {
  it('validates a proper email identifier and a known method intent, rejecting invalid variants', () => {
    const named = { firstName: 'Ada', lastName: 'Lovelace' };
    expect(signupIdentifierSchema.safeParse({ email: 'a@b.com', ...named }).success).to.equal(true);
    expect(signupIdentifierSchema.safeParse({ email: 'nope', ...named }).success).to.equal(false);

    // The name is required and trimmed: email alone, or a whitespace-only name, is rejected so
    // the account is never created with a blank or email-derived name.
    expect(signupIdentifierSchema.safeParse({ email: 'a@b.com' }).success).to.equal(false);
    expect(
      signupIdentifierSchema.safeParse({ email: 'a@b.com', firstName: '  ', lastName: 'L' }).success
    ).to.equal(false);
    const trimmed = signupIdentifierSchema.parse({
      email: 'a@b.com',
      firstName: ' Ada ',
      lastName: ' Lovelace ',
    });
    expect(trimmed.firstName).to.equal('Ada');
    expect(trimmed.lastName).to.equal('Lovelace');
    // Empty fields arrive as undefined (conform), and must fail with readable copy rather than
    // Zod's "Invalid input: expected string, received undefined".
    const empty = signupIdentifierSchema.safeParse({});
    expect(empty.success).to.equal(false);
    const messages = Object.fromEntries(
      (empty.error?.issues ?? []).map((i) => [String(i.path[0]), i.message])
    );
    expect(messages).to.deep.equal({
      email: 'Enter your email address',
      firstName: 'Enter your first name',
      lastName: 'Enter your last name',
    });
    const blank = signupIdentifierSchema.safeParse({
      email: 'a@b.com',
      firstName: ' ',
      lastName: 'L',
    });
    expect(blank.error?.issues[0]?.message).to.equal('Enter your first name');

    // Zitadel caps profile names at 200 runes.
    expect(
      signupIdentifierSchema.safeParse({
        email: 'a@b.com',
        firstName: 'x'.repeat(201),
        lastName: 'L',
      }).success
    ).to.equal(false);

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
