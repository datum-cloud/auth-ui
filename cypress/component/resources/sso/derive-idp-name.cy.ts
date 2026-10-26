// cypress/component/resources/sso/derive-idp-name.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/derive-idp-name.test.ts.
// deriveIdpProfileName is pure (string fallback chain) → runs browser-side with Chai.
import { deriveIdpProfileName } from '@/resources/sso/derive-idp-name';

type Draft = Parameters<typeof deriveIdpProfileName>[0];

const CASES: [label: string, draft: Draft, expected: { firstName: string; lastName: string }][] = [
  [
    'both names present — displayName/idpUserName ignored',
    {
      firstName: 'Ada',
      lastName: 'Lovelace',
      displayName: 'Should Be Ignored',
      idpUserName: 'ada',
    },
    { firstName: 'Ada', lastName: 'Lovelace' },
  ],
  [
    // GitHub sends no name at all — idpUserName fills BOTH fields.
    'no name at all → idpUserName in both fields',
    { idpUserName: 'anindia0703' },
    { firstName: 'anindia0703', lastName: 'anindia0703' },
  ],
  [
    'single-token displayName splits nothing → partial name mirrored into both fields',
    { firstName: 'Mario', displayName: 'Mario', idpUserName: 'markub82@gmail.com' },
    { firstName: 'Mario', lastName: 'Mario' },
  ],
  [
    'only a family name → mirrored into both fields',
    { lastName: 'Lovelace', idpUserName: 'ada@example.com' },
    { firstName: 'Lovelace', lastName: 'Lovelace' },
  ],
  [
    'multi-token displayName still splits into given/family',
    { firstName: 'Ada', displayName: 'Ada King Lovelace', idpUserName: 'ada@example.com' },
    { firstName: 'Ada King', lastName: 'Lovelace' },
  ],
  [
    // Google/OIDC IdPs report the email as the IdP userName — never use it verbatim.
    'email-shaped idpUserName → local part (+tag stripped) in both fields',
    { idpUserName: 'markub82+work@gmail.com' },
    { firstName: 'markub82', lastName: 'markub82' },
  ],
  [
    'email-shaped IdP given/family names are treated as missing',
    { firstName: 'Julio', lastName: 'julio@gmail.com', idpUserName: 'julio@gmail.com' },
    { firstName: 'Julio', lastName: 'Julio' },
  ],
  ['empty draft → "user"', {}, { firstName: 'user', lastName: 'user' }],
  [
    'whitespace-only idpUserName → "user"',
    { idpUserName: '   ' },
    { firstName: 'user', lastName: 'user' },
  ],
];

describe('deriveIdpProfileName', () => {
  it('passes through given/family names when present, mirrors a partial name, else falls back to idpUserName (never an email) for BOTH names', () => {
    for (const [label, draft, expected] of CASES) {
      expect(deriveIdpProfileName(draft), label).to.deep.equal(expected);
    }
  });
});
