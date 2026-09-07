// cypress/component/routes/signup/password.cy.ts
//
// /signup/password is RETIRED — signup is passkey-only.
//
// This spec used to exercise the route's action (ALREADY_EXISTS enumeration safety + the
// real-provider happy path). Both handlers now fail closed, so those assertions moved to where
// the properties actually live: `registerWithPassword` is still covered end-to-end in
// cypress/component/resources/signup/signup.service.cy.ts, including the enumeration-safe
// ALREADY_EXISTS path. Nothing about that security guarantee is untested — it is simply no
// longer reachable through this route.
//
// What is tested HERE is the retirement itself. Removing the "Set a password" button from
// /signup/method is display-only; this route has its own loader and action that read identity
// straight from the request with no session gate, so before the guard a bare deep link
// (/id/signup/password?loginName=…&firstName=…&lastName=…) created a password account and
// bypassed the passkey-only screen entirely.
import { callService } from '../../../support/node/call-service';

const VALID_IDENTITY = {
  loginName: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  password: 'sup3rsecret',
  confirm: 'sup3rsecret',
};

describe('signup/password — retired route: loader', () => {
  it('redirects a deep link to /signup with the address prefilled', () => {
    callService({
      fn: 'signupPasswordLoader',
      provider: 'singleton',
      request: {
        url: 'http://localhost/id/signup/password?loginName=jane%40example.com&firstName=Jane&lastName=Doe',
      },
    }).then((v) => {
      expect(v.response?.isResponse).to.equal(true);
      expect(v.response?.status).to.equal(302);
      const loc = v.response?.location ?? '';
      const url = new URL(loc, 'http://localhost');
      // /signup, NOT /signup/method: /signup registers inline and is the canonical entry, while
      // /signup/method survives only so in-flight tabs keep working — new traffic should not be
      // pushed into it.
      expect(url.pathname, 'bounces to the canonical entry point').to.equal('/signup');
      // The address rides along as ?email, which /signup prefills, so a stale link/bookmark lands
      // somewhere finishable. firstName/lastName are deliberately NOT carried: both are DERIVED
      // from the email (placeholder-name.ts) and never typed, so there is nothing to preserve.
      expect(url.searchParams.get('email')).to.equal('jane@example.com');
      expect(loc, 'derived names must not be threaded').to.not.include('firstName');
    });
  });

  it('falls back to /signup when the deep link carries no identity at all', () => {
    callService({
      fn: 'signupPasswordLoader',
      provider: 'singleton',
      request: { url: 'http://localhost/id/signup/password' },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location ?? '').to.match(/\/signup$/);
    });
  });
});

describe('signup/password — retired route: action', () => {
  // THE security assertion of this change. A POST here is not a stale bookmark — it is a request
  // to create a password account through a flow signup no longer offers. It must fail closed,
  // with no account created and no redirect that could be mistaken for success.
  it('rejects a well-formed password registration with 400 INVALID_INPUT', () => {
    callService({
      fn: 'signupPasswordAction',
      provider: 'singleton',
      env: { AUTH_EMAIL_DELIVERY_ENABLED: 'true' },
      request: {
        url: 'http://localhost/id/signup/password',
        form: { ...VALID_IDENTITY, loginName: 'deeplink@example.com' },
        csrf: true,
      },
    }).then((v) => {
      expect(v.response?.isResponse, 'must not redirect').to.equal(false);
      expect(v.response?.dataStatus).to.equal(400);
      expect(v.response?.dataBody).to.have.property('error', 'INVALID_INPUT');
      const serialized = JSON.stringify(v.response?.dataBody ?? {});
      expect(serialized, 'must not signal a successful signup').to.not.include('sent');
    });
  });
});
