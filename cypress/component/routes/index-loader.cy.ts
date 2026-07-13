// cypress/component/routes/index-loader.cy.ts
//
// NO-MOUNT / no cy.task: _index.tsx's loader has zero server-only dependencies (pure
// readCeremonyParams + paths + react-router's redirect()), so it can be called directly in the
// browser bundle — no signed cookies, no provider, no CSRF.
//
// Regression: the loader used to unconditionally redirect('/login'), dropping any incoming
// requestId/organization (e.g. a relying party or BrandLogo's home link pointing at the bare
// app root mid-ceremony).
import { loader } from '@/routes/_index';

function loaderRequest(url: string): Request {
  return new Request(url);
}

describe('_index.tsx loader — forwards requestId/organization onto /login', () => {
  it('redirects to a bare /login when no ceremony context is present', () => {
    const res = loader({ request: loaderRequest('http://localhost/id/') } as never) as Response;
    expect(res.status).to.equal(302);
    expect(res.headers.get('location')).to.equal('/login');
  });

  it('threads requestId + organization onto the /login redirect (regression: previously dropped)', () => {
    const res = loader({
      request: loaderRequest('http://localhost/id/?requestId=oidc_V2_123&organization=org-1'),
    } as never) as Response;
    expect(res.status).to.equal(302);
    expect(res.headers.get('location')).to.equal('/login?requestId=oidc_V2_123&organization=org-1');
  });

  it('threads requestId alone (organization omitted) without a stray param', () => {
    const res = loader({
      request: loaderRequest('http://localhost/id/?requestId=saml_abc'),
    } as never) as Response;
    expect(res.headers.get('location')).to.equal('/login?requestId=saml_abc');
  });
});
