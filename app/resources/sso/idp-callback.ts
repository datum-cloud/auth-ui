import type { IdpIntentResult, IdpLink, IdpUserDraft } from '@/modules/auth/types';

export interface IdpCallbackInput {
  intent: IdpIntentResult;
  link: boolean; // ?link=true on the callback URL (linking ceremony)
  sessionUserId: string | null; // resolved server-side from the ceremony cookie
  creationAllowed: boolean; // from LoginSettings.allowRegister (+ IdP config)
  // Same-email user resolved server-side (findUser + listAuthMethods) ONLY on the register
  // path. Optional so already-linked / link-ceremony callers need not compute it.
  existingAccount?: { userId: string; hasPassword: boolean } | null;
  // POSTURE B2 (755-J2): owning Datum user of the IdP email, resolved server-side via
  // provider.findUser(intent.draft.email) ONLY for the link+fresh-identity case
  // (link === true && intent.userId == null). `null` ⇒ no Datum account owns that email.
  // Used to prove the fresh IdP identity's email belongs to the SESSION user before we link
  // it — never trusted from the client. Optional so the already-linked link path and the
  // register path need not compute it.
  linkEmailOwnerUserId?: string | null;
}

export type IdpDecision =
  | { kind: 'sign-in'; userId: string }
  | { kind: 'link'; userId: string; link: IdpLink }
  | { kind: 'auto-link'; userId: string; link: IdpLink } // safe link to an existing account
  | { kind: 'link-needs-auth'; email: string } // exists but must authenticate first
  | { kind: 'auto-create'; draft: IdpUserDraft; link: IdpLink }
  | { kind: 'error'; reason: 'access-denied' | 'creation-disabled' | 'context-missing' };

function toLink(intent: IdpIntentResult): IdpLink {
  const { idpId, idpUserId, idpUserName } = intent.information;
  return { idpId, idpUserId, idpUserName };
}

export function decideIdpCallback({
  intent,
  link,
  sessionUserId,
  creationAllowed,
  existingAccount,
  linkEmailOwnerUserId,
}: IdpCallbackInput): IdpDecision {
  // ── Linking ceremony (?link=true) ──────────────────────────────────────────────
  //
  // SECURITY POSTURE B2 (755-J2). The link target is ALWAYS the active session user — an
  // identity is only ever linked into the account whose ceremony cookie we just resolved
  // server-side. We never trust a client-supplied userId. There are two shapes:
  //
  //   1. ALREADY-MAPPED identity (intent.userId present). Zitadel already maps this IdP
  //      identity to a Datum user. Require sessionUserId === intent.userId — re-linking an
  //      identity that belongs to someone else is access-denied. (Unchanged boundary.)
  //
  //   2. FRESH identity (intent.userId == null). Zitadel has no mapping yet — the original
  //      bug: this aborted with context-missing because the link target was read from the
  //      (empty) intent.userId. Now we fall back to the SESSION user, but ONLY link when the
  //      IdP itself vouches for the email AND the Datum account that already owns that email
  //      IS the session user. This blocks linking an attacker-controlled IdP identity whose
  //      email is unverified, or whose verified email belongs to a DIFFERENT Datum account
  //      (account-takeover via a borrowed/lookalike IdP identity).
  if (link) {
    // Shape 1: already mapped — equality boundary, no email proof needed.
    if (intent.userId) {
      if (sessionUserId !== intent.userId) return { kind: 'error', reason: 'access-denied' };
      return { kind: 'link', userId: intent.userId, link: toLink(intent) };
    }

    // Shape 2: fresh identity → fall back to the session user.
    // No session at all ⇒ we have no link target and no equality to assert.
    if (!sessionUserId) return { kind: 'error', reason: 'context-missing' };

    // The IdP must have verified the email — an unverified email is not proof of ownership.
    // A fresh identity with no/unverified email can never satisfy the owner check below.
    if (!intent.draft?.emailVerified) return { kind: 'error', reason: 'access-denied' };

    // The verified IdP email must already belong to the SESSION user. If a DIFFERENT Datum
    // account owns it (or — defensively — no resolved owner), linking would let the session
    // user absorb an identity tied to someone else's email → access-denied.
    if (linkEmailOwnerUserId !== sessionUserId) return { kind: 'error', reason: 'access-denied' };

    return { kind: 'link', userId: sessionUserId, link: toLink(intent) };
  }

  // Existing + linked → sign in.
  if (intent.userId) return { kind: 'sign-in', userId: intent.userId };

  // Not linked → registration territory.
  if (!creationAllowed || !intent.draft) return { kind: 'error', reason: 'creation-disabled' };

  // intent.draft is non-null from here on (guard above).
  const draft = intent.draft;
  // draft.email may be absent if the IdP omitted it; treat that as an unidentifiable
  // account — fall through to register rather than emitting a link-needs-auth with no email.
  const draftEmail = draft.email ?? '';

  // A same-email account already exists but this IdP isn't linked to it.
  if (existingAccount && draftEmail) {
    // Safe to link automatically ONLY when the IdP vouches for the email AND there is no
    // password to take over (a magic-link squatter could never sign in anyway).
    if (draft.emailVerified && !existingAccount.hasPassword) {
      return { kind: 'auto-link', userId: existingAccount.userId, link: toLink(intent) };
    }
    // Has a password OR email not IdP-verified → owner must authenticate before we link.
    return { kind: 'link-needs-auth', email: draftEmail };
  }

  // Truly new user → auto-create, link, and sign in directly in the callback.
  return { kind: 'auto-create', draft, link: toLink(intent) };
}
