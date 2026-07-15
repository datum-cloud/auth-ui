// cypress/component/resources/signup/placeholder-name.cy.ts
//
// Pure string utility → browser-side Chai only.
//
// Contract: the placeholder intentionally puts the SAME non-empty value in both name
// fields. milo's UserController sets the iam.miloapis.com/name-review-required
// annotation only when givenName != "" && givenName == familyName, which is what makes
// cloud-portal force the "Complete your profile" screen. Zitadel's AddHumanUser rejects
// empty names, so non-empty is a hard requirement, not a nicety.
import { placeholderNameFromEmail } from '@/resources/signup/placeholder-name';

const expectPlaceholder = (email: string, expected: string) => {
  const result = placeholderNameFromEmail(email);
  expect(result).to.deep.equal({ firstName: expected, lastName: expected });
  // The invariant the annotation trigger depends on, asserted explicitly on every case.
  expect(result.firstName).to.equal(result.lastName);
  expect(result.firstName.length).to.be.greaterThan(0);
};

describe('placeholderNameFromEmail', () => {
  it('returns the raw local part in BOTH fields — never splits or title-cases into fake name parts', () => {
    // The motivating bug: ordering is undecidable (this user's given name is Ollie).
    expectPlaceholder('miller_ollie@hotmail.com', 'miller_ollie');
    expectPlaceholder('john@x.com', 'john');
    expectPlaceholder('first.middle.last@x.com', 'first.middle.last');
    expectPlaceholder('a-b_c@x.com', 'a-b_c');
  });

  it('strips +tags and trims before deriving the placeholder', () => {
    expectPlaceholder('user+tag@x.com', 'user');
    expectPlaceholder('miller_ollie+newsletter@hotmail.com', 'miller_ollie');
  });

  it("falls back to 'user' when the local part is degenerate", () => {
    expectPlaceholder('@x.com', 'user');
    expectPlaceholder('+tag@x.com', 'user');
    expectPlaceholder('   @x.com', 'user');
  });

  it('caps the placeholder at 200 characters (Zitadel name-length ceiling)', () => {
    expectPlaceholder(`${'a'.repeat(250)}@x.com`, 'a'.repeat(200));
  });
});
