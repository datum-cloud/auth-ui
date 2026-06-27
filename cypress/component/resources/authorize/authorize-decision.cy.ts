import type { AuthRequest } from '@/modules/auth/types';
import {
  decideAuthorize,
  deriveOrganizationFromScopes,
} from '@/resources/authorize/authorize-decision';

const base: AuthRequest = { id: 'r1', scopes: [], prompt: [] };

describe('deriveOrganizationFromScopes', () => {
  it('extracts org id from urn:zitadel:iam:org:id:<id>', () => {
    expect(deriveOrganizationFromScopes(['openid', 'urn:zitadel:iam:org:id:12345'])).to.equal(
      '12345'
    );
  });
  it('returns undefined when absent', () => {
    expect(deriveOrganizationFromScopes(['openid'])).to.equal(undefined);
  });
});

describe('decideAuthorize', () => {
  it('CREATE prompt → /signup', () => {
    expect(
      decideAuthorize({ authRequest: { ...base, prompt: ['create'] }, hasSessions: true }).target
    ).to.equal('/signup');
  });
  it('SELECT_ACCOUNT prompt → /accounts', () => {
    expect(
      decideAuthorize({ authRequest: { ...base, prompt: ['select_account'] }, hasSessions: true })
        .target
    ).to.equal('/accounts');
  });
  it('LOGIN prompt with loginHint → /login autosubmit', () => {
    const r = decideAuthorize({
      authRequest: { ...base, prompt: ['login'], loginHint: 'a@b.c' },
      hasSessions: true,
    });
    expect(r.target).to.equal('/login');
    expect(r.params).to.include({ loginName: 'a@b.c', submit: 'true' });
  });
  it('NONE prompt with a valid session → callback', () => {
    expect(
      decideAuthorize({
        authRequest: { ...base, prompt: ['none'] },
        hasSessions: true,
        validSessionId: 's1',
      }).target
    ).to.equal('callback');
  });
  it('NONE prompt without a valid session → error(no-session)', () => {
    const r = decideAuthorize({ authRequest: { ...base, prompt: ['none'] }, hasSessions: false });
    expect(r.target).to.equal('error');
    expect(r.error).to.equal('NO_ACTIVE_SESSION');
  });
  it('default with a valid session → callback', () => {
    expect(
      decideAuthorize({ authRequest: base, hasSessions: true, validSessionId: 's1' }).target
    ).to.equal('callback');
  });
  it('default without sessions → /login', () => {
    expect(decideAuthorize({ authRequest: base, hasSessions: false }).target).to.equal('/login');
  });
});
