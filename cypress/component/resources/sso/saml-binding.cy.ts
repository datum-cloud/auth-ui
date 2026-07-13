// cypress/component/resources/sso/saml-binding.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/saml-binding.test.ts.
// resolveSamlBinding is pure (binding select + field shaping, throws on bad input) → Chai.
import type { SamlResponse } from '@/modules/auth/types';
import { resolveSamlBinding } from '@/resources/sso/saml-binding';

describe('resolveSamlBinding', () => {
  it('redirect binding yields a redirect result', () => {
    const r: SamlResponse = { url: 'https://sp.test/acs?SAMLResponse=abc', binding: 'redirect' };
    expect(resolveSamlBinding(r)).to.deep.equal({ kind: 'redirect', url: r.url });
  });

  it('post binding yields the form fields', () => {
    const r: SamlResponse = {
      url: 'https://sp.test/acs',
      binding: 'post',
      relayState: 'rs',
      samlResponse: 'b64',
    };
    expect(resolveSamlBinding(r)).to.deep.equal({
      kind: 'post',
      url: 'https://sp.test/acs',
      fields: { RelayState: 'rs', SAMLResponse: 'b64' },
    });
  });
});
