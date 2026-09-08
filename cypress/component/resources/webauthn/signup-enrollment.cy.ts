// cypress/component/resources/webauthn/signup-enrollment.cy.ts
//
// Pure predicate behind /setup/passkey's Back suppression. Pins the prefix boundary:
// the signup leg is identified by returnTo, and nothing else may match it.
import { isSignupEnrollment } from '@/resources/webauthn/signup-enrollment';

describe('isSignupEnrollment', () => {
  it('matches the returnTo completeEmailLinkSignup threads', () => {
    expect(isSignupEnrollment('/signup/success?loginName=a%40b.test&requestId=rq1')).to.equal(true);
    expect(isSignupEnrollment('/signup/success')).to.equal(true);
  });

  it('does not match a later security-settings enrolment', () => {
    expect(isSignupEnrollment('/passkeys')).to.equal(false);
    expect(isSignupEnrollment('/signed-in')).to.equal(false);
  });

  it('requires the trailing slash, so a sibling route beginning with "signup" never matches', () => {
    expect(isSignupEnrollment('/signup')).to.equal(false);
    expect(isSignupEnrollment('/signup-other/success')).to.equal(false);
  });

  it('treats an absent returnTo as not-signup (the default keeps Back visible)', () => {
    expect(isSignupEnrollment(undefined)).to.equal(false);
    expect(isSignupEnrollment(null)).to.equal(false);
    expect(isSignupEnrollment('')).to.equal(false);
  });
});
