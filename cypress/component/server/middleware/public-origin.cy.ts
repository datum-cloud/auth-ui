// cypress/component/server/middleware/public-origin.cy.ts
// Pure Request → Request mapper — no node deps.
import { withPublicOrigin } from '@/server/middleware/public-origin';

const PUBLIC_ORIGIN = 'https://auth.staging.env.datum.net';

// TLS ends at the gateway, so the pod sees plain http. React Router 8.4 compares the
// browser's `Origin` (https) against request.url's full origin, so an http request.url
// rejects every action POST with 400.
function proxiedAction(url = 'http://auth.staging.env.datum.net/id/login.data?index'): Request {
  return new Request(url, {
    method: 'POST',
    // Browsers drop a forbidden `origin` header here; a regular header proves headers carry over.
    headers: { 'x-trace': 'abc', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'intent=idp&idpId=google',
  });
}

describe('withPublicOrigin', () => {
  it('rebuilds request.url on the public origin, keeping path, query, method, headers and body', () => {
    const out = withPublicOrigin(proxiedAction(), PUBLIC_ORIGIN);
    expect(out.url).to.equal('https://auth.staging.env.datum.net/id/login.data?index');
    expect(out.method).to.equal('POST');
    expect(out.headers.get('x-trace')).to.equal('abc');
    return out.text().then((body) => expect(body).to.equal('intent=idp&idpId=google'));
  });

  it('pins the host to PUBLIC_ORIGIN, never a client-supplied Host', () => {
    const out = withPublicOrigin(
      proxiedAction('http://attacker.example/id/login.data'),
      PUBLIC_ORIGIN
    );
    expect(new URL(out.url).origin).to.equal(PUBLIC_ORIGIN);
  });

  it('returns the request untouched when the origin already matches', () => {
    const req = new Request(`${PUBLIC_ORIGIN}/id/login`);
    expect(withPublicOrigin(req, PUBLIC_ORIGIN)).to.equal(req);
  });

  it('returns the request untouched when PUBLIC_ORIGIN is unset (dev / fake provider)', () => {
    const req = proxiedAction();
    expect(withPublicOrigin(req, undefined)).to.equal(req);
  });
});
