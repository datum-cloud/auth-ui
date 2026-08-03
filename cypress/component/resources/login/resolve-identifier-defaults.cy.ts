// cypress/component/resources/login/resolve-identifier-defaults.cy.ts
//
// Component (no-mount) merge of three former single-test specs, each pinning the DEFAULT-OFF
// branch of a different Zitadel login-policy flag:
//   • resolve-identifier-domain-discovery.cy.ts — allowDomainDiscovery off → no domain lookup
//   • resolve-identifier-email-disabled.cy.ts   — disableLoginWithEmail off → unchanged
//   • resolve-identifier-ignore-unknown.cy.ts   — ignoreUnknownUsernames off → unchanged
//
// All three made the same resolveIdentifier call with a different provider seed and asserted
// the IDENTICAL result, so they collapse into one table keyed by the flag under test. The
// seeds are preserved verbatim — each one is what makes its flag's "off" branch meaningful
// (an orgDomains seed that must NOT be consulted, a non-email loginName, an email loginName).
import { FakeAuthProvider } from '@/modules/auth/providers/fake/fake-provider';
import { resolveIdentifier } from '@/resources/login';

type Seed = ConstructorParameters<typeof FakeAuthProvider>[0];

const CASES: [flag: string, seed: Seed][] = [
  // A seeded org domain that must never be consulted while discovery is off.
  ['allowDomainDiscovery OFF — no domain lookup', { orgDomains: { 'acme.test': 'org-acme' } }],
  // A non-email loginName: the email-shaped identifier must still miss.
  [
    'disableLoginWithEmail OFF — detect-for-copy unchanged',
    { users: [{ id: 'u1', loginName: 'alice' }] },
  ],
  // An email loginName that simply does not match the queried one.
  [
    'ignoreUnknownUsernames OFF — unknown identifier still reported',
    { users: [{ id: 'u1', loginName: 'alice@acme.test' }] },
  ],
];

describe('resolveIdentifier — policy-flag defaults (all OFF)', () => {
  it('reports USER_NOT_FOUND for an unknown identifier under every default-off policy flag', async () => {
    for (const [flag, seed] of CASES) {
      const provider = new FakeAuthProvider(seed);
      const result = await resolveIdentifier(provider, [], {
        loginName: 'ghost@acme.test',
        emailDeliveryEnabled: true,
      });
      expect(result, flag).to.deep.equal({ ok: false, error: 'USER_NOT_FOUND' });
    }
  });
});
