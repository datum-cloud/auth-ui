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
  ['empty draft → "user"', {}, { firstName: 'user', lastName: 'user' }],
  [
    'whitespace-only idpUserName → "user"',
    { idpUserName: '   ' },
    { firstName: 'user', lastName: 'user' },
  ],
];

describe('deriveIdpProfileName', () => {
  it('passes through given/family names when present, falls back to idpUserName for BOTH names, then to "user"', () => {
    for (const [label, draft, expected] of CASES) {
      expect(deriveIdpProfileName(draft), label).to.deep.equal(expected);
    }
  });
});
