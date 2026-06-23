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

  it('301s device → /id/device, preserving the ?user_code= query string', () => {
    // The CLI device flow (datumctl --no-browser) sends users to
    // /ui/v2/login/device?user_code=WDJB-MJHT — the user_code MUST survive the legacy
    // redirect so /id/device can pre-resolve the grant (mirrors the idp/link case above).
    cy.request({ url: '/ui/v2/login/device?user_code=WDJB-MJHT', followRedirect: false }).then(
      (res) => {
        expect(res.status).to.eq(301);
        expect(res.headers.location).to.eq('/id/device?user_code=WDJB-MJHT');
      }
    );
  });

  it('301s an unknown legacy subpath to the login index', () => {
    cy.request({ url: '/ui/v2/login/bogus', followRedirect: false }).then((res) => {
      expect(res.status).to.eq(301);
      expect(res.headers.location).to.eq('/id/login');
    });
  });
});
