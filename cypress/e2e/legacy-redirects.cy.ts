describe('legacy /ui/v2/login redirects', () => {
  it('301s idp/link → /id/sso/link, preserving the query string', () => {
    cy.request({ url: '/ui/v2/login/idp/link?organization=acme', followRedirect: false }).then(
      (res) => {
        expect(res.status).to.eq(301);
        expect(res.headers.location).to.eq('/id/sso/link?organization=acme');
      }
    );
  });

  it('301s a prefix-swap path (device)', () => {
    cy.request({ url: '/ui/v2/login/device', followRedirect: false }).then((res) => {
      expect(res.status).to.eq(301);
      expect(res.headers.location).to.eq('/id/device');
    });
  });

  it('301s an unknown legacy subpath to the login index', () => {
    cy.request({ url: '/ui/v2/login/bogus', followRedirect: false }).then((res) => {
      expect(res.status).to.eq(301);
      expect(res.headers.location).to.eq('/id/login');
    });
  });
});
