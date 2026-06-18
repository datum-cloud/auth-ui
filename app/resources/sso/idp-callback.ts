import type { IdpIntentResult, IdpLink, IdpUserDraft } from '@/modules/auth/types';

export interface IdpCallbackInput {
  intent: IdpIntentResult;
  link: boolean; // ?link=true on the callback URL (linking ceremony)
  sessionUserId: string | null; // resolved server-side from the ceremony cookie
  creationAllowed: boolean; // from LoginSettings.allowRegister (+ IdP config)
  // Same-email user resolved server-side (findUser + listAuthMethods) ONLY on the register
  // path. Optional so already-linked / link-ceremony callers need not compute it.
  existingAccount?: { userId: string; hasPassword: boolean } | null;
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
}: IdpCallbackInput): IdpDecision {
  // Linking ceremony: the active session user MUST equal the intent user (security boundary).
  if (link) {
    if (!intent.userId) return { kind: 'error', reason: 'context-missing' };
    if (sessionUserId !== intent.userId) return { kind: 'error', reason: 'access-denied' };
    return { kind: 'link', userId: intent.userId, link: toLink(intent) };
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
