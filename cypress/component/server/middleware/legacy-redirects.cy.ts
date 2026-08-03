// cypress/component/server/middleware/legacy-redirects.cy.ts
// COMPONENT port of app/server/middleware/__tests__/legacy-redirects.test.ts
// Pure string → string mapper — no node deps.
import { legacyRedirectTarget } from '@/server/middleware/legacy-redirects';

// null means "not a legacy path — leave it alone"; a string is the rewrite target.
const CASES: [label: string, path: string, query: string, expected: string | null][] = [
  [
    'idp/link renamed, query preserved',
    '/ui/v2/login/idp/link',
    '?organization=acme',
    '/id/sso/link?organization=acme',
  ],
  ['unknown legacy subpath falls back to the login index', '/ui/v2/login/bogus', '', '/id/login'],
  ['over-long legacy subpath falls back too', '/ui/v2/login/idp/link/extra', '', '/id/login'],
  ['already-current path is not a legacy path', '/id/login', '', null],
  ['prefix lookalike is not a legacy path', '/ui/v2/loginXYZ', '', null],
];

describe('legacyRedirectTarget', () => {
  it('rewrites legacy login paths (preserving the query), falls back to the login index for unknown subpaths, and returns null for non-legacy paths', () => {
    for (const [label, path, query, expected] of CASES) {
      expect(legacyRedirectTarget(path, query), label).to.equal(expected);
    }
  });
});
