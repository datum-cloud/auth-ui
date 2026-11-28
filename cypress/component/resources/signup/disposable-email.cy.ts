// cypress/component/resources/signup/disposable-email.cy.ts
//
// Pure module, so it runs browser-side against the real list from disposable-email-domains-js.
import { isDisposableEmail } from '@/resources/signup/disposable-email';

describe('isDisposableEmail', () => {
  it('matches a listed domain', () => {
    expect(isDisposableEmail('test@mailinator.com')).to.equal(true);
  });

  it('matches regardless of case, and on a subdomain of a listed domain', () => {
    expect(isDisposableEmail('User@Sub.Mailinator.COM')).to.equal(true);
  });

  it('does not match a domain that only ends with a listed name', () => {
    // Matching is per label: mailinator.com is listed, acmemailinator.com is not.
    expect(isDisposableEmail('someone@acmemailinator.com')).to.equal(false);
  });

  it('does not match an ordinary provider', () => {
    expect(isDisposableEmail('someone@gmail.com')).to.equal(false);
  });

  it('answers false, without throwing, for a string with no @', () => {
    expect(isDisposableEmail('not-an-address')).to.equal(false);
    expect(isDisposableEmail('')).to.equal(false);
  });

  it('never matches on the top-level label alone', () => {
    // A bare "com" entry would block every .com address; only suffixes of two labels or more count.
    expect(isDisposableEmail('someone@example.com')).to.equal(false);
  });
});
