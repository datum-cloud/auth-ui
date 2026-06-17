import {
  isEmailLike,
  isPhoneLike,
  makeLoginIdentifierClientSchema,
} from '@/resources/login/login.schema';
import { describe, it, expect } from 'vitest';

describe('isPhoneLike', () => {
  it('true for phone-shaped input with no @', () => {
    expect(isPhoneLike('+15550000000')).toBe(true);
    expect(isPhoneLike('0612345678')).toBe(true);
    expect(isPhoneLike('+1 555 000 0000')).toBe(true);
  });
  it('false for emails, usernames, domain-suffixed usernames, and empty', () => {
    expect(isPhoneLike('a@b.c')).toBe(false);
    expect(isPhoneLike('alice')).toBe(false);
    expect(isPhoneLike('alice@acme.test')).toBe(false);
    expect(isPhoneLike('')).toBe(false);
  });
});

describe('makeLoginIdentifierClientSchema', () => {
  it('rejectPhone:true rejects phone-format, accepts email/username/domain-suffixed', () => {
    const s = makeLoginIdentifierClientSchema({ rejectPhone: true });
    expect(s.safeParse({ loginName: '+15550000000' }).success).toBe(false);
    expect(s.safeParse({ loginName: 'alice' }).success).toBe(true);
    expect(s.safeParse({ loginName: 'a@b.c' }).success).toBe(true);
    expect(s.safeParse({ loginName: 'alice@acme.test' }).success).toBe(true);
  });
  it('rejectPhone:false accepts everything non-empty (today behavior)', () => {
    const s = makeLoginIdentifierClientSchema({ rejectPhone: false });
    expect(s.safeParse({ loginName: '+15550000000' }).success).toBe(true);
    expect(s.safeParse({ loginName: '' }).success).toBe(false);
  });
});

describe('isEmailLike', () => {
  it('matches email-shaped identifiers (incl. domain-suffixed usernames)', () => {
    expect(isEmailLike('a@b.com')).toBe(true);
    expect(isEmailLike('alice@acme.test')).toBe(true);
    expect(isEmailLike('alice@acme.zitadel.cloud')).toBe(true);
    expect(isEmailLike('  alice@acme.test  ')).toBe(true); // trimmed
  });

  it('rejects non-email identifiers', () => {
    expect(isEmailLike('alice')).toBe(false); // plain username
    expect(isEmailLike('+15550000000')).toBe(false); // phone
    expect(isEmailLike('a@b')).toBe(false); // no dot in domain
    expect(isEmailLike('@b.com')).toBe(false); // empty local part
    expect(isEmailLike('a@')).toBe(false); // empty domain
    expect(isEmailLike('')).toBe(false);
  });
});
