// cypress/component/resources/sso/saml-binding.cy.ts
//
// Component (no-mount) port of app/resources/sso/__tests__/saml-binding.test.ts.
// resolveSamlBinding is pure (binding select + field shaping, throws on bad input) → Chai.
import type { SamlResponse } from '@/modules/auth/types';
import { resolveSamlBinding } from '@/resources/sso/saml-binding';

// Capture the thrown error's message directly. Cypress's bundled Chai `.to.throw(regex)` matcher
// mis-handles errors constructed in the Vite app-bundle realm (cross-realm Error), so we assert on
// the message ourselves — same regression coverage, realm-safe.
function throwMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('expected function to throw, but it did not');
}

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

  it('post binding missing fields throws', () => {
    const r: SamlResponse = { url: 'https://sp.test/acs', binding: 'post' };
    expect(throwMessage(() => resolveSamlBinding(r))).to.match(/missing SAML POST fields/i);
  });

  it('post binding with only relayState missing throws', () => {
    const r: SamlResponse = { url: 'https://sp.test/acs', binding: 'post', samlResponse: 'b64' };
    expect(throwMessage(() => resolveSamlBinding(r))).to.match(/missing SAML POST fields/i);
  });

  it('post binding with only samlResponse missing throws', () => {
    const r: SamlResponse = { url: 'https://sp.test/acs', binding: 'post', relayState: 'rs' };
    expect(throwMessage(() => resolveSamlBinding(r))).to.match(/missing SAML POST fields/i);
  });

  it('unknown binding from the transport throws', () => {
    const r = { url: 'https://sp.test/acs', binding: 'artifact' } as unknown as SamlResponse;
    expect(throwMessage(() => resolveSamlBinding(r))).to.match(/unsupported SAML binding/i);
  });
});
