// cypress/component/resources/sso/sso-management.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/sso-management.test.ts (755-M6).
// joinLinkedIdps is the pure link↔active-IdP join + dedupe — imported from the module (not the
// heavy barrel) so the browser bundle stays light; runs browser-side with Chai.
import type { AuthMethod, IdpLink, IdProvider } from '@/modules/auth/types';
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

describe('joinLinkedIdps — per-identity dedupe (multi-identity mode)', () => {
  it('keeps two identities of the SAME provider as separate rows when perIdentity=true', () => {
    const a = linkOf('idp-github', 'gh-a', 'a-handle');
    const b = linkOf('idp-github', 'gh-c', 'c-handle');
    const out = joinLinkedIdps([a, b], [GITHUB], true);
    expect(out).to.have.length(2);
    expect(out.map((v) => v.idpUserId)).to.deep.equal(['gh-a', 'gh-c']);
    expect(out.every((v) => v.name === 'GitHub')).to.equal(true);
  });

  it('still collapses exact-duplicate identity rows (partial-link residue) when perIdentity=true', () => {
    const dup = linkOf('idp-github', 'gh-a', 'a-handle');
    const out = joinLinkedIdps([dup, { ...dup }], [GITHUB], true);
    expect(out).to.have.length(1);
    expect(out[0].idpUserId).to.equal('gh-a');
  });

  it('per-provider dedupe (perIdentity=false / default) is unchanged — same idpId collapses', () => {
    const out = joinLinkedIdps(
      [linkOf('idp-github', 'gh-a'), linkOf('idp-github', 'gh-c')],
      [GITHUB],
      false
    );
    expect(out).to.have.length(1);
    expect(out[0].idpUserId).to.equal('gh-a');
  });
});

describe('linkableProviders — env-gated link options', () => {
  it('returns ALL active providers when allowMulti=true (always offer another)', () => {
    const linked = joinLinkedIdps([linkOf('idp-github', 'gh-a')], [GITHUB], true);
    const out = linkableProviders([GOOGLE, GITHUB], linked, true);
    expect(out.map((p) => p.id)).to.deep.equal(['idp-google', 'idp-github']);
  });

  it('filters out already-linked providers when allowMulti=false (legacy one-per-provider)', () => {
    const linked = joinLinkedIdps([linkOf('idp-github', 'gh-a')], [GITHUB], false);
    const out = linkableProviders([GOOGLE, GITHUB], linked, false);
    expect(out.map((p) => p.id)).to.deep.equal(['idp-google']);
  });

  it('returns all active providers when nothing is linked (either mode)', () => {
    expect(linkableProviders([GOOGLE, GITHUB], [], true).map((p) => p.id)).to.deep.equal([
      'idp-google',
      'idp-github',
    ]);
    expect(linkableProviders([GOOGLE, GITHUB], [], false).map((p) => p.id)).to.deep.equal([
      'idp-google',
      'idp-github',
    ]);
  });
});

describe('canUnlinkIdp — login-method-aware lockout guard', () => {
  const gh = linkOf('idp-github', 'gh-1', 'a-handle');
  const goog = linkOf('idp-google', 'g-1', 'you@gmail.com');

  it('allows unlink when ANOTHER IdP link remains', () => {
    expect(canUnlinkIdp(gh, [gh, goog], [] as AuthMethod[])).to.equal(true);
  });

  it('allows unlink of the only IdP when a password exists', () => {
    expect(canUnlinkIdp(gh, [gh], ['idp', 'password'])).to.equal(true);
  });

  it('allows unlink of the only IdP when a passkey exists', () => {
    expect(canUnlinkIdp(gh, [gh], ['idp', 'passkey'])).to.equal(true);
  });

  it('BLOCKS unlink of the only IdP with no password/passkey (would lock out)', () => {
    expect(canUnlinkIdp(gh, [gh], ['idp'])).to.equal(false);
  });

  it('BLOCKS when only second factors remain (totp/otp are not primary)', () => {
    expect(canUnlinkIdp(gh, [gh], ['idp', 'totp', 'otp_email'])).to.equal(false);
  });

  it('matches the "other link" on idpId AND idpUserId (a second identity of the same provider counts)', () => {
    const gh2 = linkOf('idp-github', 'gh-2', 'c-handle');
    expect(canUnlinkIdp(gh, [gh, gh2], ['idp'])).to.equal(true);
  });
});
