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

// The four plain routing decisions on the link=false path. Only these are table-driven —
// every ownership / POSTURE-B2 guard below stays standalone so an identity-takeover
// regression fails in isolation and is immediately diagnosable.
//
// `full` means the whole decision object is pinned; `kind` means only the discriminant was
// ever asserted (the auto-create case), preserved exactly rather than tightened.
const ROUTING: Array<{
  label: string;
  input: Parameters<typeof decideIdpCallback>[0];
  full?: ReturnType<typeof decideIdpCallback>;
  kind?: string;
}> = [
  {
    label: 'email IdP-verified, existing account has no password → auto-link',
    input: {
      ...base,
      intent: intentOf({ emailVerified: true }),
      existingAccount: { userId: 'u1', hasPassword: false },
    },
    full: { kind: 'auto-link', userId: 'u1', link: LINK },
  },
  {
    label: 'existing account has a password → link-needs-auth',
    input: {
      ...base,
      intent: intentOf({ emailVerified: true }),
      existingAccount: { userId: 'u1', hasPassword: true },
    },
    full: { kind: 'link-needs-auth', email: 'you@gmail.com' },
  },
  {
    label: 'no existing account matches → auto-create',
    input: { ...base, intent: intentOf(), existingAccount: null },
    kind: 'auto-create',
  },
  {
    label: 'IdP identity already linked → sign-in',
    input: { ...base, intent: intentOf({ userId: 'u9' }), existingAccount: null },
    full: { kind: 'sign-in', userId: 'u9' },
  },
];

describe('decideIdpCallback — existing-account handling', () => {
  it('routes each existing-account shape to the right decision (auto-link / link-needs-auth / auto-create / sign-in)', () => {
    for (const { label, input, full, kind } of ROUTING) {
      const d = decideIdpCallback(input);
      if (full) expect(d, label).to.deep.equal(full);
      else expect(d.kind, label).to.equal(kind);
    }
  });
});

describe('decideIdpCallback — link-ceremony and creation-disabled guards', () => {
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
});
