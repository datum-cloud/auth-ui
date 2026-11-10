// cypress/component/routes/device/authorize-loader.cy.ts
//
// /device/authorize loader, driven through the real route export. The three outcomes the
// consent screen depends on: a live code yields the consent payload, a missing code bounces to
// the code-entry screen, and a stale code returns the tagged 404 the route renders as
// "Code expired" (authorize-recovery.cy.tsx covers that render).
// Node-bound: the loader mints a signed CSRF cookie and reads the signed `sessions` cookie.
import { callService } from '../../../support/node/call-service';

const AUTHORIZE = 'http://localhost/id/device/authorize';

interface ConsentBody {
  csrfToken: string;
  activeLoginName: string | null;
  appName: string;
  scope: string[];
  deviceAuthId: string;
  requestId: string;
}

describe('/device/authorize loader', () => {
  it('a live user code returns the consent payload for the signed-in account', () => {
    callService({
      fn: 'deviceAuthorizeLoader',
      provider: 'singleton',
      request: {
        url: `${AUTHORIZE}?user_code=WDJB-MJHT`,
        sessions: [{ id: 'sess-1', token: 'tok-1', loginName: 'mia@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(false);
      const body = v.response?.dataBody as ConsentBody;
      expect(body.appName).to.equal('CLI');
      expect(body.scope).to.deep.equal(['openid']);
      expect(body.deviceAuthId).to.equal('dev-1');
      expect(body.requestId).to.equal('device_WDJB-MJHT');
      expect(body.activeLoginName).to.equal('mia@acme.test');
      expect(body.csrfToken).to.be.a('string').and.not.equal('');
    });
  });

  it('a live user code with no session leaves activeLoginName null (sign-in CTA branch)', () => {
    callService({
      fn: 'deviceAuthorizeLoader',
      provider: 'singleton',
      request: { url: `${AUTHORIZE}?user_code=WDJB-MJHT` },
    }).then((v) => {
      const body = v.response?.dataBody as ConsentBody;
      expect(body.deviceAuthId).to.equal('dev-1');
      expect(body.activeLoginName).to.equal(null);
    });
  });

  it('a missing user_code redirects to the /device code-entry screen', () => {
    callService({
      fn: 'deviceAuthorizeLoader',
      provider: 'singleton',
      request: { url: AUTHORIZE },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/device');
    });
  });

  it('a stale user code returns the tagged 404 recovery error, not a thrown response', () => {
    callService({
      fn: 'deviceAuthorizeLoader',
      provider: 'singleton',
      request: { url: `${AUTHORIZE}?user_code=GONE-CODE` },
    }).then((v) => {
      expect(v.ok, v.error).to.equal(true);
      expect(v.response?.isResponse).to.equal(false);
      expect(v.response?.dataStatus).to.equal(404);
      const body = v.response?.dataBody as { error: { code: string; recovery: string } };
      expect(body.error.code).to.equal('INVALID_INPUT');
      expect(body.error.recovery).to.equal('device');
      // The neutral error carries no user code back to the page.
      expect(JSON.stringify(body)).to.not.include('GONE-CODE');
    });
  });
});
