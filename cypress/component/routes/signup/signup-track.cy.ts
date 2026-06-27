// cypress/component/routes/signup/signup-track.cy.ts
//
// cy.task port of app/routes/signup/__tests__/signup-track.test.tsx.
// Covers signup/index loader (URL threading, IdP prefill, registrationDisabled) and
// action (email → /signup/method redirect, IdP intent → 302, validation failures).
import { callService } from '../../../support/node/call-service';

// ── Loader ────────────────────────────────────────────────────────────────────

describe('signup/index — loader', () => {
  it('returns csrfToken and view from settings', () => {
    callService({
      fn: 'signupIndexLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/signup' },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.csrfToken).to.be.ok;
      expect(body?.view).to.not.be.undefined;
    });
  });

  it('reads organization and requestId from URL params', () => {
    callService({
      fn: 'signupIndexLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/signup?organization=acme&requestId=req123' },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.organization).to.equal('acme');
      expect(body?.requestId).to.equal('req123');
    });
  });

  it('preserves idpIntentId prefill when all IdP params are present', () => {
    callService({
      fn: 'signupIndexLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup?idpIntentId=intent1&idpIntentToken=tok&idpId=idp1&idpUserId=u1&idpUserName=alice',
      },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      const idp = body?.idp as Record<string, string> | undefined;
      expect(idp?.idpIntentId).to.equal('intent1');
      expect(idp?.idpIntentToken).to.equal('tok');
      expect(idp?.idpId).to.equal('idp1');
      expect(idp?.idpUserId).to.equal('u1');
      expect(idp?.idpUserName).to.equal('alice');
    });
  });

  it('sets view.registrationDisabled=true when allowRegister=false', () => {
    callService({
      fn: 'signupIndexLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/signup' },
      mockLoginSettings: { allowRegister: false },
    }).then((v) => {
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      const view = body?.view as Record<string, unknown> | undefined;
      expect(view?.registrationDisabled).to.equal(true);
    });
  });
});

// ── Action: email identifier ──────────────────────────────────────────────────

describe('signup/index — action: email identifier', () => {
  it('redirects (302) to /signup/method with parsed loginName/firstName/lastName', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { email: 'john.doe@example.com' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      const url = new URL(loc, 'http://localhost');
      expect(url.pathname).to.equal('/signup/method');
      expect(url.searchParams.get('loginName')).to.equal('john.doe@example.com');
      expect(url.searchParams.get('firstName')).to.equal('John');
      expect(url.searchParams.get('lastName')).to.equal('Doe');
    });
  });

  it('threads organization and requestId into the /signup/method redirect', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { email: 'alice@example.com', organization: 'acme', requestId: 'req-abc' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const url = new URL(v.response?.location ?? '', 'http://localhost');
      expect(url.searchParams.get('organization')).to.equal('acme');
      expect(url.searchParams.get('requestId')).to.equal('req-abc');
    });
  });

  it('threads deviceTrackingToken when present', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { email: 'user@example.com', deviceTrackingToken: 'mm-token-abc' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      const url = new URL(v.response?.location ?? '', 'http://localhost');
      expect(url.searchParams.get('deviceTrackingToken')).to.equal('mm-token-abc');
    });
  });

  it('returns 400 INVALID_INPUT for a non-email value', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { email: 'not-an-email' },
        csrf: true,
      },
    }).then((v) => {
      const status = v.response?.isResponse ? v.response.status : v.response?.dataStatus;
      expect(status).to.equal(400);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.error).to.equal('INVALID_INPUT');
    });
  });
});

// ── Action: IdP intent ────────────────────────────────────────────────────────

describe('signup/index — action: IdP intent', () => {
  it('redirects (302) to the IdP authUrl for a seeded IdP (idp-g)', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { intent: 'idp', idpId: 'idp-g' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
    });
  });

  it('returns 400 INVALID_INPUT when idpId is missing', () => {
    callService({
      fn: 'signupIndexAction',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup',
        form: { intent: 'idp' },
        csrf: true,
      },
    }).then((v) => {
      const status = v.response?.isResponse ? v.response.status : v.response?.dataStatus;
      expect(status).to.equal(400);
      const body = v.response?.dataBody as Record<string, unknown> | undefined;
      expect(body?.error).to.equal('INVALID_INPUT');
    });
  });
});
