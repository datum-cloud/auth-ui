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
});
