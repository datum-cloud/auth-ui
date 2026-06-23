// 755-M6 unit tests for joinLinkedIdps — the link↔active-IdP join + dedupe.
//
// joinLinkedIdps is the pure shaping function behind resolveSsoManagement: it joins the bare
// provider IdpLink[] ({idpId, idpUserId, idpUserName}) to the active-IdP list by idpId to attach
// the display fields ({name, type, logoUrl}) the route renders as a provider badge, and dedupes
// the linked list by idpId (defensive against 755-J2 partial-link residue). Driven directly so
// the join + dedupe are covered in isolation from the loader's session/CSRF I/O.
import type { IdpLink, IdProvider } from '@/modules/auth/types';
import { joinLinkedIdps } from '@/resources/sso';
import { describe, it, expect } from 'vitest';

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
    expect(out).toEqual([
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
    expect(view.name).toBe('GitHub');
    expect(view.type).toBe('GITHUB');
    expect(view.logoUrl).toBeUndefined();
  });

  it('leaves a link without a matching active IdP as the bare link (no display fields)', () => {
    // A link whose provider was deactivated: no join target → renders without a badge.
    const out = joinLinkedIdps([linkOf('idp-orphan')], [GOOGLE]);
    expect(out).toEqual([
      { idpId: 'idp-orphan', idpUserId: 'remote-1', idpUserName: 'you@idp.test' },
    ]);
    expect(out[0]).not.toHaveProperty('name');
    expect(out[0]).not.toHaveProperty('type');
  });

  it('dedupes by idpId, keeping the FIRST occurrence (partial-link residue guard)', () => {
    const first = linkOf('idp-google', 'first', 'first@idp.test');
    const dup = linkOf('idp-google', 'second', 'second@idp.test');
    const out = joinLinkedIdps([first, dup], [GOOGLE]);
    expect(out).toHaveLength(1);
    expect(out[0].idpUserId).toBe('first');
    expect(out[0].idpUserName).toBe('first@idp.test');
    expect(out[0].name).toBe('Google');
  });

  it('preserves distinct IdPs while deduping only same-idpId rows', () => {
    const out = joinLinkedIdps(
      [linkOf('idp-google'), linkOf('idp-github'), linkOf('idp-google', 'dup')],
      [GOOGLE, GITHUB]
    );
    expect(out.map((v) => v.idpId)).toEqual(['idp-google', 'idp-github']);
    expect(out).toHaveLength(2);
  });

  it('returns an empty array when there are no links', () => {
    expect(joinLinkedIdps([], [GOOGLE, GITHUB])).toEqual([]);
  });
});
