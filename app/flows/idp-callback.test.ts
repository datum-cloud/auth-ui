import { decideIdpCallback } from './idp-callback';
import type { IdpIntentResult } from '@/providers/types';
import { describe, it, expect } from 'vitest';

const baseInfo = { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' };
const linked: IdpIntentResult = { information: baseInfo, userId: 'u1', draft: null };
const unknownUser: IdpIntentResult = {
  information: baseInfo,
  userId: null,
  draft: { email: 'alice@acme.test', firstName: 'Alice', lastName: 'A', emailVerified: true },
};

describe('decideIdpCallback', () => {
  it('outcome 1 — existing+linked, not a link request → sign-in', () => {
    const d = decideIdpCallback({
      intent: linked,
      link: false,
      sessionUserId: null,
      creationAllowed: true,
    });
    expect(d).toEqual({ kind: 'sign-in', userId: 'u1' });
  });

  it('outcome 2 — link request whose session user matches → link-then-sign-in', () => {
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

  it('outcome 3 — not found, creation allowed → register-and-link (signup prefill)', () => {
    const d = decideIdpCallback({
      intent: unknownUser,
      link: false,
      sessionUserId: null,
      creationAllowed: true,
    });
    expect(d).toEqual({
      kind: 'register',
      draft: unknownUser.draft,
      link: { idpId: 'idp-g', idpUserId: 'g-1', idpUserName: 'alice' },
    });
  });

  it('guard — link request whose session user differs → access-denied error', () => {
    const d = decideIdpCallback({
      intent: linked,
      link: true,
      sessionUserId: 'other',
      creationAllowed: true,
    });
    expect(d).toEqual({ kind: 'error', reason: 'access-denied' });
  });

  it('guard — not found and creation disabled → error', () => {
    const d = decideIdpCallback({
      intent: unknownUser,
      link: false,
      sessionUserId: null,
      creationAllowed: false,
    });
    expect(d).toEqual({ kind: 'error', reason: 'creation-disabled' });
  });
});
