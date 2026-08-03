// cypress/component/resources/sso/saml-binding.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/saml-binding.test.ts.
// resolveSamlBinding is pure (binding select + field shaping, throws on bad input) → Chai.
import type { SamlResponse } from '@/modules/auth/types';
import { resolveSamlBinding } from '@/resources/sso/saml-binding';

describe('resolveSamlBinding', () => {
  it('yields a redirect result for the redirect binding and shaped form fields for the post binding', () => {
    const redirect: SamlResponse = {
      url: 'https://sp.test/acs?SAMLResponse=abc',
      binding: 'redirect',
    };
    expect(resolveSamlBinding(redirect), 'redirect binding').to.deep.equal({
      kind: 'redirect',
      url: redirect.url,
    });

    const post: SamlResponse = {
      url: 'https://sp.test/acs',
      binding: 'post',
      relayState: 'rs',
      samlResponse: 'b64',
    };
    expect(resolveSamlBinding(post), 'post binding').to.deep.equal({
      kind: 'post',
      url: 'https://sp.test/acs',
      fields: { RelayState: 'rs', SAMLResponse: 'b64' },
    });
  });
});
