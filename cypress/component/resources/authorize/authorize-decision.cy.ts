import type { AuthRequest } from '@/modules/auth/types';
import { decideAuthorize } from '@/resources/authorize/authorize-decision';

const base: AuthRequest = { id: 'r1', scopes: [], prompt: [] };

// Plain prompt routing. The prompt=none silent-auth gate is deliberately NOT in this table —
// it is the OIDC security decision and stays standalone below.
const ROUTING: Array<{
  label: string;
  prompt: string[];
  hasSessions: boolean;
  organization?: string;
  target: string;
  params?: Record<string, string>;
}> = [
  { label: 'CREATE prompt', prompt: ['create'], hasSessions: true, target: '/signup' },
  {
    // issue #99: never render an empty picker.
    label: 'SELECT_ACCOUNT with no sessions',
    prompt: ['select_account'],
    hasSessions: false,
    target: '/login',
  },
  {
    label: 'SELECT_ACCOUNT with sessions (the picker is the right screen)',
    prompt: ['select_account'],
    hasSessions: true,
    target: '/accounts',
  },
  {
    label: 'SELECT_ACCOUNT threads organization onto the session-less /login bootstrap',
    prompt: ['select_account'],
    hasSessions: false,
    organization: 'org-1',
    target: '/login',
    params: { organization: 'org-1' },
  },
];

describe('decideAuthorize', () => {
  it('routes each prompt to the right screen, threading organization onto the session-less bootstrap', () => {
    for (const { label, prompt, hasSessions, organization, target, params } of ROUTING) {
      const r = decideAuthorize({ authRequest: { ...base, prompt }, hasSessions, organization });
      expect(r.target, `${label}: target`).to.equal(target);
      if (params) expect(r.params, `${label}: params`).to.deep.equal(params);
    }
  });

  // Silent-auth gate: prompt=none must never fall back to an interactive screen.
  it('NONE prompt without a valid session → error(no-session)', () => {
    const r = decideAuthorize({ authRequest: { ...base, prompt: ['none'] }, hasSessions: false });
    expect(r.target).to.equal('error');
    expect(r.error).to.equal('NO_ACTIVE_SESSION');
  });
});
