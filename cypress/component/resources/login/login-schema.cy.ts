// cypress/component/resources/login/login-schema.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/login-schema.test.ts.
// Pure Zod schema utilities → browser-side Chai only.
import { isEmailLike, isPhoneLike } from '@/resources/login/login.schema';

describe('isPhoneLike', () => {
  it('true for phone-shaped input with no @', () => {
    expect(isPhoneLike('+15550000000')).to.equal(true);
    expect(isPhoneLike('0612345678')).to.equal(true);
    expect(isPhoneLike('+1 555 000 0000')).to.equal(true);
  });
});

describe('isEmailLike', () => {
  it('matches email-shaped identifiers (incl. domain-suffixed usernames)', () => {
    expect(isEmailLike('a@b.com')).to.equal(true);
    expect(isEmailLike('alice@acme.test')).to.equal(true);
    expect(isEmailLike('alice@acme.zitadel.cloud')).to.equal(true);
    expect(isEmailLike('  alice@acme.test  ')).to.equal(true);
  });
});
