import type { IdpIntentResult, IdpLink, IdpUserDraft } from '@/providers/types';

export interface IdpCallbackInput {
  intent: IdpIntentResult;
  link: boolean; // ?link=true on the callback URL (linking ceremony)
  sessionUserId: string | null; // resolved server-side from the ceremony cookie
  creationAllowed: boolean; // from LoginSettings.allowRegister (+ IdP config)
}

export type IdpDecision =
  | { kind: 'sign-in'; userId: string }
  | { kind: 'link'; userId: string; link: IdpLink }
  | { kind: 'register'; draft: IdpUserDraft; link: IdpLink }
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
}: IdpCallbackInput): IdpDecision {
  // Linking ceremony: the active session user MUST equal the intent user (security boundary).
  if (link) {
    if (!intent.userId) return { kind: 'error', reason: 'context-missing' };
    if (sessionUserId !== intent.userId) return { kind: 'error', reason: 'access-denied' };
    return { kind: 'link', userId: intent.userId, link: toLink(intent) };
  }

  // Existing + linked → sign in.
  if (intent.userId) return { kind: 'sign-in', userId: intent.userId };

  // Not found → register-and-link if allowed, else error.
  if (!creationAllowed || !intent.draft) return { kind: 'error', reason: 'creation-disabled' };
  return { kind: 'register', draft: intent.draft, link: toLink(intent) };
}
