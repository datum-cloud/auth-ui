// cypress/component/resources/login/login-schema.cy.ts
//
// Component (no-mount) port of app/resources/login/__tests__/login-schema.test.ts.
// Pure Zod schema utilities → browser-side Chai only.
import {
  isEmailLike,
  isPhoneLike,
  makeLoginIdentifierClientSchema,
} from '@/resources/login/login.schema';

describe('isPhoneLike', () => {
  it('true for phone-shaped input with no @', () => {
    expect(isPhoneLike('+15550000000')).to.equal(true);
    expect(isPhoneLike('0612345678')).to.equal(true);
    expect(isPhoneLike('+1 555 000 0000')).to.equal(true);
  });

  it('false for emails, usernames, domain-suffixed usernames, and empty', () => {
    expect(isPhoneLike('a@b.c')).to.equal(false);
    expect(isPhoneLike('alice')).to.equal(false);
    expect(isPhoneLike('alice@acme.test')).to.equal(false);
    expect(isPhoneLike('')).to.equal(false);
  });
});

describe('makeLoginIdentifierClientSchema', () => {
  it('rejectPhone:true rejects phone-format, accepts email/username/domain-suffixed', () => {
    const s = makeLoginIdentifierClientSchema({ rejectPhone: true });
    expect(s.safeParse({ loginName: '+15550000000' }).success).to.equal(false);
    expect(s.safeParse({ loginName: 'alice' }).success).to.equal(true);
    expect(s.safeParse({ loginName: 'a@b.c' }).success).to.equal(true);
    expect(s.safeParse({ loginName: 'alice@acme.test' }).success).to.equal(true);
  });

  it('rejectPhone:false accepts everything non-empty (today behavior)', () => {
    const s = makeLoginIdentifierClientSchema({ rejectPhone: false });
    expect(s.safeParse({ loginName: '+15550000000' }).success).to.equal(true);
    expect(s.safeParse({ loginName: '' }).success).to.equal(false);
  });
});

describe('isEmailLike', () => {
  it('matches email-shaped identifiers (incl. domain-suffixed usernames)', () => {
    expect(isEmailLike('a@b.com')).to.equal(true);
    expect(isEmailLike('alice@acme.test')).to.equal(true);
    expect(isEmailLike('alice@acme.zitadel.cloud')).to.equal(true);
    expect(isEmailLike('  alice@acme.test  ')).to.equal(true);
  });

  it('rejects non-email identifiers', () => {
    expect(isEmailLike('alice')).to.equal(false);
    expect(isEmailLike('+15550000000')).to.equal(false);
    expect(isEmailLike('a@b')).to.equal(false);
    expect(isEmailLike('@b.com')).to.equal(false);
    expect(isEmailLike('a@')).to.equal(false);
    expect(isEmailLike('')).to.equal(false);
  });
});
