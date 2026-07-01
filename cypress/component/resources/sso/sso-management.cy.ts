// cypress/component/resources/sso/sso-management.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/sso-management.test.ts (755-M6).
// joinLinkedIdps is the pure link↔active-IdP join + dedupe — imported from the module (not the
// heavy barrel) so the browser bundle stays light; runs browser-side with Chai.
import type { IdpLink, IdProvider } from '@/modules/auth/types';
import { canUnlinkIdp, joinLinkedIdps, linkableProviders } from '@/resources/sso/sso-management';

const GOOGLE: IdProvider = {
  id: 'idp-google',
  name: 'Google',
  type: 'GOOGLE',
  logoUrl: 'https://logo.test/google.svg',
};
const GITHUB: IdProvider = { id: 'idp-github', name: 'GitHub', type: 'GITHUB' };

function linkOf(idpId: string, idpUserId = 'remote-1', idpUserName = 'you@idp.test'): IdpLink {
  return { idpId, idpUserId, idpUserName };
}

describe('joinLinkedIdps — 755-M6 join + dedupe', () => {
  it('dedupes by idpId keeping the FIRST occurrence by default; keeps separate rows per identity when perIdentity=true', () => {
    const first = linkOf('idp-google', 'first', 'first@idp.test');
    const dup = linkOf('idp-google', 'second', 'second@idp.test');
    const out = joinLinkedIdps([first, dup], [GOOGLE]);
    expect(out).to.have.length(1);
    expect(out[0].idpUserId).to.equal('first');
    expect(out[0].idpUserName).to.equal('first@idp.test');
    expect(out[0].name).to.equal('Google');

    const a = linkOf('idp-github', 'gh-a', 'a-handle');
    const b = linkOf('idp-github', 'gh-c', 'c-handle');
    const perIdentityOut = joinLinkedIdps([a, b], [GITHUB], true);
    expect(perIdentityOut).to.have.length(2);
    expect(perIdentityOut.map((v) => v.idpUserId)).to.deep.equal(['gh-a', 'gh-c']);
    expect(perIdentityOut.every((v) => v.name === 'GitHub')).to.equal(true);
  });
});

describe('linkableProviders — env-gated link options', () => {
  it('filters out already-linked providers when allowMulti=false (legacy one-per-provider)', () => {
    const linked = joinLinkedIdps([linkOf('idp-github', 'gh-a')], [GITHUB], false);
    const out = linkableProviders([GOOGLE, GITHUB], linked, false);
    expect(out.map((p) => p.id)).to.deep.equal(['idp-google']);
  });
});

describe('canUnlinkIdp — login-method-aware lockout guard', () => {
  const gh = linkOf('idp-github', 'gh-1', 'a-handle');

  it('BLOCKS unlink of the only IdP with no password/passkey (would lock out)', () => {
    expect(canUnlinkIdp(gh, [gh], ['idp'])).to.equal(false);
  });
});
