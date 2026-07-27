// cypress/component/routes/reauth/provider-callback.cy.tsx
//
// /reauth/:provider/callback loader: reads the CURRENT session, verifies the idpIntent
// onto it via performReauth, and redirects — success to returnTo, failure to
// /reauth/:provider/error, no-session to /login. Headless (element renders null),
// mirrors sso/provider/callback.tsx's own test-via-loader-harness convention.
import { callService } from '../../../support/node/call-service';

const URL =
  'http://localhost/id/reauth/idp-google/callback?id=intent-1&token=idp-tok-1&returnTo=%2Fpasskeys';

describe('/reauth/:provider/callback loader', () => {
  it('a matching idpIntent verifies onto the existing session and redirects to returnTo', () => {
    callService({
      fn: 'reauthProviderCallback',
      seed: {
        users: [{ id: 'u1', loginName: 'mia@acme.test' }],
        idpIntents: {
          'intent-1': { idpIntentId: 'intent-1', idpIntentToken: 'idp-tok-1', userId: 'u1' },
        },
      },
      slug: 'idp-google',
      liveSessions: [
        { id: 'sess-1', token: 'sess-tok-1', user: { id: 'u1', loginName: 'mia@acme.test' } },
      ],
      request: {
        url: URL,
        sessions: [{ id: 'sess-1', token: 'sess-tok-1', loginName: 'mia@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/passkeys');
      expect(v.response?.setCookie ?? '').to.include('sessions=');
    });
  });

  it('a mismatched idpIntent redirects to /reauth/:provider/error with returnTo preserved', () => {
    callService({
      fn: 'reauthProviderCallback',
      seed: {
        users: [
          { id: 'u1', loginName: 'mia@acme.test' },
          { id: 'u2', loginName: 'bob@acme.test' },
        ],
        idpIntents: {
          'intent-1': { idpIntentId: 'intent-1', idpIntentToken: 'idp-tok-1', userId: 'u2' },
        },
      },
      slug: 'idp-google',
      liveSessions: [
        { id: 'sess-1', token: 'sess-tok-1', user: { id: 'u1', loginName: 'mia@acme.test' } },
      ],
      request: {
        url: URL,
        sessions: [{ id: 'sess-1', token: 'sess-tok-1', loginName: 'mia@acme.test' }],
      },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.include('/reauth/idp-google/error');
      expect(v.response?.location).to.include('returnTo=%2Fpasskeys');
      // Real Zitadel rejects this exact case with FAILED_PRECONDITION ("Intent meant
      // for another user"), not INVALID_CREDENTIALS — performReauth must catch it
      // (not let it escape as an unhandled 500) and the redirect must carry a reason
      // the error page can render distinct copy for.
      expect(v.response?.location).to.include('reason=access-denied');
    });
  });

  it('no session redirects to /login', () => {
    callService({
      fn: 'reauthProviderCallback',
      seed: { users: [{ id: 'u1', loginName: 'mia@acme.test' }] },
      slug: 'idp-google',
      request: { url: URL },
    }).then((v) => {
      expect(v.response?.status).to.equal(302);
      expect(v.response?.location).to.equal('/login');
    });
  });
});
