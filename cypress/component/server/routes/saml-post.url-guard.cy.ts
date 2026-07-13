// cypress/component/server/routes/saml-post.url-guard.cy.ts
// COMPONENT port of:
//   - app/server/routes/__tests__/saml-post.url-guard.test.ts (assertHttpUrl)
//   - samlPostHandler tests for renderSamlPostForm (pure renderer — no node deps)
import { assertHttpUrl, renderSamlPostForm } from '@/server/routes/saml-post';

describe('assertHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(() => assertHttpUrl('https://sp.example/acs')).not.to.throw();
    expect(() => assertHttpUrl('http://sp.example/acs')).not.to.throw();
  });

  it('rejects javascript: and other non-http schemes', () => {
    expect(() => assertHttpUrl('javascript:alert(1)')).to.throw();
    expect(() => assertHttpUrl('data:text/html,x')).to.throw();
    expect(() => assertHttpUrl('not a url')).to.throw();
  });
});

describe('renderSamlPostForm', () => {
  it('HTML-attribute-escapes field values and the url (XSS defence)', () => {
    const html = renderSamlPostForm(
      'https://sp.test/acs?x="><script>',
      { RelayState: '"><img src=x>', SAMLResponse: 'b64' },
      'n-1'
    );
    expect(html).not.to.include('"><script>');
    expect(html).not.to.include('"><img');
    expect(html).to.include('&quot;&gt;&lt;script&gt;');
    expect(html).to.include('&quot;&gt;&lt;img src=x&gt;');
  });
});
