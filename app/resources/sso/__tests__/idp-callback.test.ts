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

// ---------------------------------------------------------------------------
// 755-J2 · POSTURE B2 · fresh-IdP link falls back to the session user, gated by
// verified-email ownership. The fresh-link intent has userId:null (Zitadel has no
// mapping yet); the link target must come from the resolved session user, and we
// only link when the verified IdP email's owning account IS that session user.
// ---------------------------------------------------------------------------

// A FRESH-identity link intent: no Zitadel mapping yet (userId:null), draft carries the
// IdP-vouched email + emailVerified flag.
function freshLinkIntent(
  over: Partial<{ emailVerified: boolean; email: string }> = {}
): IdpIntentResult {
  return {
    userId: null,
    information: { idpId: 'idp-g', idpUserId: 'g-fresh', idpUserName: 'you@gmail.com' },
    draft: {
      email: over.email ?? 'you@gmail.com',
      firstName: 'You',
      lastName: 'User',
      emailVerified: over.emailVerified ?? true,
    },
  } as IdpIntentResult;
}

const FRESH_LINK = { idpId: 'idp-g', idpUserId: 'g-fresh', idpUserName: 'you@gmail.com' };

describe('decideIdpCallback — 755-J2 fresh-identity link (POSTURE B2)', () => {
  it('links the fresh identity into the SESSION user when the verified email owner is that user', () => {
    const d = decideIdpCallback({
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      linkEmailOwnerUserId: 'u1', // verified email belongs to the session user
    });
    expect(d).toEqual({ kind: 'link', userId: 'u1', link: FRESH_LINK });
  });

  it('access-denied when the verified email is owned by a DIFFERENT account', () => {
    const d = decideIdpCallback({
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      linkEmailOwnerUserId: 'other', // email belongs to someone else → takeover guard
    });
    expect(d).toEqual({ kind: 'error', reason: 'access-denied' });
  });

  it('access-denied when no Datum account owns the verified email (owner null)', () => {
    const d = decideIdpCallback({
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      linkEmailOwnerUserId: null,
    });
    expect(d).toEqual({ kind: 'error', reason: 'access-denied' });
  });

  it('access-denied when the IdP did NOT verify the email (no proof of ownership)', () => {
    const d = decideIdpCallback({
      intent: freshLinkIntent({ emailVerified: false }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      linkEmailOwnerUserId: 'u1', // even owner-match is insufficient without verification
    });
    expect(d).toEqual({ kind: 'error', reason: 'access-denied' });
  });

  it('context-missing when there is neither an intent user NOR a session user', () => {
    const d = decideIdpCallback({
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: null,
      creationAllowed: true,
      linkEmailOwnerUserId: null,
    });
    expect(d).toEqual({ kind: 'error', reason: 'context-missing' });
  });

  it('already-mapped link (intent.userId present) still requires session === intent user', () => {
    const mapped: IdpIntentResult = {
      userId: 'u1',
      information: FRESH_LINK,
      draft: null,
    };
    // matching session → link
    expect(
      decideIdpCallback({
        intent: mapped,
        link: true,
        sessionUserId: 'u1',
        creationAllowed: true,
      })
    ).toEqual({ kind: 'link', userId: 'u1', link: FRESH_LINK });
    // differing session → access-denied (email proof is NOT consulted on the mapped path)
    expect(
      decideIdpCallback({
        intent: mapped,
        link: true,
        sessionUserId: 'other',
        creationAllowed: true,
        linkEmailOwnerUserId: 'other',
      })
    ).toEqual({ kind: 'error', reason: 'access-denied' });
  });
});
