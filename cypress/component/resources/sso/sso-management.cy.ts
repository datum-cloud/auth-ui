// cypress/component/resources/sso/sso-management.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/sso-management.test.ts (755-M6).
// joinLinkedIdps is the pure link↔active-IdP join + dedupe — imported from the module (not the
// heavy barrel) so the browser bundle stays light; runs browser-side with Chai.
import type { IdpLink, IdProvider } from '@/modules/auth/types';
import { joinLinkedIdps } from '@/resources/sso/sso-management';

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
  it('attaches {name, type, logoUrl} from the matching active IdP', () => {
    const out = joinLinkedIdps([linkOf('idp-google')], [GOOGLE, GITHUB]);
    expect(out).to.deep.equal([
      {
        idpId: 'idp-google',
        idpUserId: 'remote-1',
        idpUserName: 'you@idp.test',
        name: 'Google',
        type: 'GOOGLE',
        logoUrl: 'https://logo.test/google.svg',
      },
    ]);
  });

  it('omits logoUrl when the active IdP has none (GitHub) but still attaches name + type', () => {
    const [view] = joinLinkedIdps([linkOf('idp-github')], [GITHUB]);
    expect(view.name).to.equal('GitHub');
    expect(view.type).to.equal('GITHUB');
    expect(view.logoUrl).to.equal(undefined);
  });

  it('leaves a link without a matching active IdP as the bare link (no display fields)', () => {
    const out = joinLinkedIdps([linkOf('idp-orphan')], [GOOGLE]);
    expect(out).to.deep.equal([
      { idpId: 'idp-orphan', idpUserId: 'remote-1', idpUserName: 'you@idp.test' },
    ]);
    expect(out[0]).to.not.have.property('name');
    expect(out[0]).to.not.have.property('type');
  });

  it('dedupes by idpId, keeping the FIRST occurrence (partial-link residue guard)', () => {
    const first = linkOf('idp-google', 'first', 'first@idp.test');
    const dup = linkOf('idp-google', 'second', 'second@idp.test');
    const out = joinLinkedIdps([first, dup], [GOOGLE]);
    expect(out).to.have.length(1);
    expect(out[0].idpUserId).to.equal('first');
    expect(out[0].idpUserName).to.equal('first@idp.test');
    expect(out[0].name).to.equal('Google');
  });

  it('preserves distinct IdPs while deduping only same-idpId rows', () => {
    const out = joinLinkedIdps(
      [linkOf('idp-google'), linkOf('idp-github'), linkOf('idp-google', 'dup')],
      [GOOGLE, GITHUB]
    );
    expect(out.map((v) => v.idpId)).to.deep.equal(['idp-google', 'idp-github']);
    expect(out).to.have.length(2);
  });

  it('returns an empty array when there are no links', () => {
    expect(joinLinkedIdps([], [GOOGLE, GITHUB])).to.deep.equal([]);
  });
});
