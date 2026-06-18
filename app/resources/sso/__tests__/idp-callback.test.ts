import { decideIdpCallback } from '../idp-callback';
import type { IdpIntentResult } from '@/modules/auth/types';
import { describe, it, expect } from 'vitest';

function intentOf(
  over: Partial<{ userId: string | null; emailVerified: boolean; email: string }> = {}
): IdpIntentResult {
  return {
    userId: over.userId ?? null,
    information: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' },
    draft: {
      email: over.email ?? 'you@gmail.com',
      firstName: 'You',
      lastName: 'User',
      emailVerified: over.emailVerified ?? true,
    },
  } as IdpIntentResult;
}

const base = { link: false, sessionUserId: null, creationAllowed: true } as const;
const LINK = { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' };

describe('decideIdpCallback — existing-account handling', () => {
  it('auto-links when email is IdP-verified and the account has no password', () => {
    const d = decideIdpCallback({
      ...base,
      intent: intentOf({ emailVerified: true }),
      existingAccount: { userId: 'u1', hasPassword: false },
    });
    expect(d).toEqual({ kind: 'auto-link', userId: 'u1', link: LINK });
  });

  it('requires sign-in when the existing account has a password', () => {
    const d = decideIdpCallback({
      ...base,
      intent: intentOf({ emailVerified: true }),
      existingAccount: { userId: 'u1', hasPassword: true },
    });
    expect(d).toEqual({ kind: 'link-needs-auth', email: 'you@gmail.com' });
  });

  it('requires sign-in when the IdP did not verify the email', () => {
    const d = decideIdpCallback({
      ...base,
      intent: intentOf({ emailVerified: false }),
      existingAccount: { userId: 'u1', hasPassword: false },
    });
    expect(d).toEqual({ kind: 'link-needs-auth', email: 'you@gmail.com' });
  });

  it('auto-creates when no existing account matches', () => {
    const d = decideIdpCallback({ ...base, intent: intentOf(), existingAccount: null });
    expect(d.kind).toBe('auto-create');
  });

  it('still signs in when the IdP identity is already linked', () => {
    const d = decideIdpCallback({
      ...base,
      intent: intentOf({ userId: 'u9' }),
      existingAccount: null,
    });
    expect(d).toEqual({ kind: 'sign-in', userId: 'u9' });
  });
});

// ---------------------------------------------------------------------------
// Security-boundary cases (recovered from pre-auto-link commit e74960c78)
// ---------------------------------------------------------------------------

// Fixtures matching the original test's shape (linked user, unknown user).
const baseInfo = { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' };
const linked: IdpIntentResult = { information: baseInfo, userId: 'u1', draft: null };

describe('decideIdpCallback — link-ceremony and creation-disabled guards', () => {
  it('link request whose session user matches → kind "link"', () => {
    const d = decideIdpCallback({
      intent: linked,
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
    });
    expect(d).toEqual({
      kind: 'link',
      userId: 'u1',
      link: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' },
    });
  });

  it('link request whose session user differs → kind "error" reason "access-denied"', () => {
    const d = decideIdpCallback({
      intent: linked,
      link: true,
      sessionUserId: 'other',
      creationAllowed: true,
    });
    expect(d).toEqual({ kind: 'error', reason: 'access-denied' });
  });

  it('not found and creation disabled → kind "error" reason "creation-disabled"', () => {
    const d = decideIdpCallback({
      intent: intentOf(),
      link: false,
      sessionUserId: null,
      creationAllowed: false,
    });
    expect(d).toEqual({ kind: 'error', reason: 'creation-disabled' });
  });
});
