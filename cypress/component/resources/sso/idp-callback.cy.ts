// cypress/component/resources/sso/idp-callback.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/idp-callback.test.ts.
// SECURITY-CRITICAL: decideIdpCallback is the pure identity-matching / link-takeover guard
// (POSTURE B2). It imports only types, so it runs browser-side with Chai unchanged.
import type { IdpIntentResult } from '@/modules/auth/types';
import { decideIdpCallback } from '@/resources/sso/idp-callback';

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

const base = {
  link: false,
  sessionUserId: null,
  creationAllowed: true,
  allowAutoLink: true, // existing existing-account cases assert the legacy auto-link/link-needs-auth path
  allowLinkAnyEmail: true, // irrelevant on the link=false path; present for type-completeness
} as const;
// Link-ceremony cases assert strict POSTURE B2 — any-email linking OFF.
const linkBase = { allowAutoLink: false, allowLinkAnyEmail: false } as const;
const LINK = { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'you@gmail.com' };

describe('decideIdpCallback — existing-account handling', () => {
  it('auto-links when email is IdP-verified and the account has no password', () => {
    const d = decideIdpCallback({
      ...base,
      intent: intentOf({ emailVerified: true }),
      existingAccount: { userId: 'u1', hasPassword: false },
    });
    expect(d).to.deep.equal({ kind: 'auto-link', userId: 'u1', link: LINK });
  });

  it('requires sign-in when the existing account has a password', () => {
    const d = decideIdpCallback({
      ...base,
      intent: intentOf({ emailVerified: true }),
      existingAccount: { userId: 'u1', hasPassword: true },
    });
    expect(d).to.deep.equal({ kind: 'link-needs-auth', email: 'you@gmail.com' });
  });

  it('requires sign-in when the IdP did not verify the email', () => {
    const d = decideIdpCallback({
      ...base,
      intent: intentOf({ emailVerified: false }),
      existingAccount: { userId: 'u1', hasPassword: false },
    });
    expect(d).to.deep.equal({ kind: 'link-needs-auth', email: 'you@gmail.com' });
  });

  it('auto-creates when no existing account matches', () => {
    const d = decideIdpCallback({ ...base, intent: intentOf(), existingAccount: null });
    expect(d.kind).to.equal('auto-create');
  });

  it('still signs in when the IdP identity is already linked', () => {
    const d = decideIdpCallback({
      ...base,
      intent: intentOf({ userId: 'u9' }),
      existingAccount: null,
    });
    expect(d).to.deep.equal({ kind: 'sign-in', userId: 'u9' });
  });
});

// ── Security-boundary cases (recovered from pre-auto-link commit e74960c78) ──
const baseInfo = { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' };
const linked: IdpIntentResult = { information: baseInfo, userId: 'u1', draft: null };

describe('decideIdpCallback — link-ceremony and creation-disabled guards', () => {
  it('link request whose session user matches → kind "link"', () => {
    const d = decideIdpCallback({
      ...linkBase,
      intent: linked,
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
    });
    expect(d).to.deep.equal({
      kind: 'link',
      userId: 'u1',
      link: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' },
    });
  });

  it('link request whose session user differs → kind "error" reason "access-denied"', () => {
    const d = decideIdpCallback({
      ...linkBase,
      intent: linked,
      link: true,
      sessionUserId: 'other',
      creationAllowed: true,
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'access-denied' });
  });

  it('not found and creation disabled → kind "error" reason "creation-disabled"', () => {
    const d = decideIdpCallback({
      ...linkBase,
      intent: intentOf(),
      link: false,
      sessionUserId: null,
      creationAllowed: false,
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'creation-disabled' });
  });
});

// ── 755-J2 · POSTURE B2 · fresh-IdP link gated by verified-email ownership ──
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
      ...linkBase,
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      linkEmailOwnerUserId: 'u1',
    });
    expect(d).to.deep.equal({ kind: 'link', userId: 'u1', link: FRESH_LINK });
  });

  it('access-denied when the verified email is owned by a DIFFERENT account', () => {
    const d = decideIdpCallback({
      ...linkBase,
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      linkEmailOwnerUserId: 'other',
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'access-denied' });
  });

  it('access-denied when no Datum account owns the verified email (owner null)', () => {
    const d = decideIdpCallback({
      ...linkBase,
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      linkEmailOwnerUserId: null,
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'access-denied' });
  });

  it('access-denied when the IdP did NOT verify the email (no proof of ownership)', () => {
    const d = decideIdpCallback({
      ...linkBase,
      intent: freshLinkIntent({ emailVerified: false }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      linkEmailOwnerUserId: 'u1',
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'access-denied' });
  });

  it('context-missing when there is neither an intent user NOR a session user', () => {
    const d = decideIdpCallback({
      ...linkBase,
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: null,
      creationAllowed: true,
      linkEmailOwnerUserId: null,
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'context-missing' });
  });

  it('already-mapped link (intent.userId present) still requires session === intent user', () => {
    const mapped: IdpIntentResult = { userId: 'u1', information: FRESH_LINK, draft: null };
    expect(
      decideIdpCallback({
        ...linkBase,
        intent: mapped,
        link: true,
        sessionUserId: 'u1',
        creationAllowed: true,
      })
    ).to.deep.equal({ kind: 'link', userId: 'u1', link: FRESH_LINK });
    expect(
      decideIdpCallback({
        ...linkBase,
        intent: mapped,
        link: true,
        sessionUserId: 'other',
        creationAllowed: true,
        linkEmailOwnerUserId: 'other',
      })
    ).to.deep.equal({ kind: 'error', reason: 'access-denied' });
  });
});

// ── Req 1 · same-email collision is a hard error when auto-link is OFF ──────────
describe('decideIdpCallback — same-email hard error (allowAutoLink=false)', () => {
  it('errors account-exists when a same-email account exists (verified, passwordless)', () => {
    const d = decideIdpCallback({
      ...base,
      allowAutoLink: false,
      intent: intentOf({ emailVerified: true }),
      existingAccount: { userId: 'u1', hasPassword: false },
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'account-exists' });
  });

  it('errors account-exists even when the existing account has a password', () => {
    const d = decideIdpCallback({
      ...base,
      allowAutoLink: false,
      intent: intentOf({ emailVerified: true }),
      existingAccount: { userId: 'u1', hasPassword: true },
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'account-exists' });
  });

  it('still auto-creates when NO same-email account exists', () => {
    const d = decideIdpCallback({
      ...base,
      allowAutoLink: false,
      intent: intentOf(),
      existingAccount: null,
    });
    expect(d.kind).to.equal('auto-create');
  });
});

// ── Req 2 · fresh identity links regardless of email when any-email is ON ───────
describe('decideIdpCallback — email-agnostic link (allowLinkAnyEmail=true)', () => {
  it('links a fresh identity into the session user even when the email owner differs', () => {
    const d = decideIdpCallback({
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      allowAutoLink: false,
      allowLinkAnyEmail: true,
      linkEmailOwnerUserId: 'other', // ignored when any-email is on
    });
    expect(d).to.deep.equal({ kind: 'link', userId: 'u1', link: FRESH_LINK });
  });

  it('links a fresh identity even when the IdP did NOT verify the email', () => {
    const d = decideIdpCallback({
      intent: freshLinkIntent({ emailVerified: false }),
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      allowAutoLink: false,
      allowLinkAnyEmail: true,
    });
    expect(d).to.deep.equal({ kind: 'link', userId: 'u1', link: FRESH_LINK });
  });

  it('still requires a session user (context-missing) with any-email on', () => {
    const d = decideIdpCallback({
      intent: freshLinkIntent({ emailVerified: true }),
      link: true,
      sessionUserId: null,
      creationAllowed: true,
      allowAutoLink: false,
      allowLinkAnyEmail: true,
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'context-missing' });
  });

  it('still rejects grabbing an already-mapped identity owned by another user', () => {
    const mapped = { userId: 'u9', information: FRESH_LINK, draft: null } as IdpIntentResult;
    const d = decideIdpCallback({
      intent: mapped,
      link: true,
      sessionUserId: 'u1',
      creationAllowed: true,
      allowAutoLink: false,
      allowLinkAnyEmail: true,
    });
    expect(d).to.deep.equal({ kind: 'error', reason: 'access-denied' });
  });
});
