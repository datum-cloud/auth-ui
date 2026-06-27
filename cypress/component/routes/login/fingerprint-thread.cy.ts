// cypress/component/routes/login/fingerprint-thread.cy.ts
//
// cy.task port of app/routes/login/__tests__/fingerprint-thread.test.ts.
// The identifier action mints a fingerprintId cookie when one is absent, and reuses the
// existing one (no Set-Cookie) when the browser already carries it.
import { callService } from '../../../support/node/call-service';

describe('fingerprintId cookie thread through the /login identifier action', () => {
  it('cookie ABSENT: mints a fingerprintId Set-Cookie alongside the session cookie', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: 'alice@acme.test' },
        csrf: true,
        // No fingerprintId → action must mint one
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const cookies = v.response?.setCookies ?? [];
      expect(cookies.some((c: string) => c.startsWith('sessions='))).to.equal(true);
      const fp = cookies.find((c: string) => c.startsWith('fingerprintId='));
      expect(fp).to.be.a('string');
      const value = decodeURIComponent(fp!.split(';')[0].slice('fingerprintId='.length));
      expect(value).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(fp).to.contain('Max-Age=31536000');
      expect(fp).to.contain('Path=/');
      expect(fp).to.contain('HttpOnly');
    });
  });

  it('cookie PRESENT: reused — no new fingerprintId Set-Cookie is emitted', () => {
    callService({
      fn: 'loginAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/login',
        form: { loginName: 'alice@acme.test' },
        csrf: true,
        fingerprintId: 'already-have-one',
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const cookies = v.response?.setCookies ?? [];
      expect(cookies.some((c: string) => c.startsWith('sessions='))).to.equal(true);
      expect(cookies.some((c: string) => c.startsWith('fingerprintId='))).to.equal(false);
    });
  });
});
