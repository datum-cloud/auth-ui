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

const expectPlaceholder = (email: string, expected: string, label: string) => {
  const result = placeholderNameFromEmail(email);
  expect(result, label).to.deep.equal({ firstName: expected, lastName: expected });
  // The invariant the annotation trigger depends on, asserted explicitly on every case.
  expect(result.firstName, `${label}: both fields match`).to.equal(result.lastName);
  expect(result.firstName.length, `${label}: non-empty`).to.be.greaterThan(0);
};

// Every case was already a call to the same helper, split across four `it()`s purely by
// theme — collapsed into one table, with the theme kept as each row's label.
const CASES: [label: string, email: string, expected: string][] = [
  // Raw local part in BOTH fields — never split or title-cased into fake name parts.
  // The motivating bug: ordering is undecidable (this user's given name is Ollie).
  ['raw local part', 'miller_ollie@hotmail.com', 'miller_ollie'],
  ['raw local part', 'john@x.com', 'john'],
  ['raw local part with dots', 'first.middle.last@x.com', 'first.middle.last'],
  ['raw local part with dashes/underscores', 'a-b_c@x.com', 'a-b_c'],
  // +tags stripped and whitespace trimmed before deriving the placeholder.
  ['strips +tag', 'user+tag@x.com', 'user'],
  ['strips +tag', 'miller_ollie+newsletter@hotmail.com', 'miller_ollie'],
  // Degenerate local parts fall back to 'user' (Zitadel rejects empty names).
  ['degenerate: no local part', '@x.com', 'user'],
  ['degenerate: tag only', '+tag@x.com', 'user'],
  ['degenerate: whitespace only', '   @x.com', 'user'],
  // Zitadel name-length ceiling.
  ['caps at 200 characters', `${'a'.repeat(250)}@x.com`, 'a'.repeat(200)],
];

describe('placeholderNameFromEmail', () => {
  it('duplicates the sanitized local part into both name fields, capped at 200 characters', () => {
    for (const [label, email, expected] of CASES) {
      expectPlaceholder(email, expected, `${label} (${email})`);
    }
  });
});
