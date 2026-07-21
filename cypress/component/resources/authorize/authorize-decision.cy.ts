import type { AuthRequest } from '@/modules/auth/types';
import { decideAuthorize } from '@/resources/authorize/authorize-decision';

const base: AuthRequest = { id: 'r1', scopes: [], prompt: [] };

describe('decideAuthorize', () => {
  it('CREATE prompt → /signup', () => {
    expect(
      decideAuthorize({ authRequest: { ...base, prompt: ['create'] }, hasSessions: true }).target
    ).to.equal('/signup');
  });
  it('NONE prompt without a valid session → error(no-session)', () => {
    const r = decideAuthorize({ authRequest: { ...base, prompt: ['none'] }, hasSessions: false });
    expect(r.target).to.equal('error');
    expect(r.error).to.equal('NO_ACTIVE_SESSION');
  });

  it('SELECT_ACCOUNT with no sessions → /login (issue #99: never an empty picker)', () => {
    const r = decideAuthorize({
      authRequest: { ...base, prompt: ['select_account'] },
      hasSessions: false,
    });
    expect(r.target).to.equal('/login');
  });

  it('SELECT_ACCOUNT with sessions → /accounts (the picker is still the right screen)', () => {
    const r = decideAuthorize({
      authRequest: { ...base, prompt: ['select_account'] },
      hasSessions: true,
    });
    expect(r.target).to.equal('/accounts');
  });

  it('SELECT_ACCOUNT threads organization onto the session-less /login bootstrap', () => {
    const r = decideAuthorize({
      authRequest: { ...base, prompt: ['select_account'] },
      hasSessions: false,
      organization: 'org-1',
    });
    expect(r.target).to.equal('/login');
    expect(r.params).to.deep.equal({ organization: 'org-1' });
  });
});
