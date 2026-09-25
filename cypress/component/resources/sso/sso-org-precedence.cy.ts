// cypress/component/resources/sso/sso-org-precedence.cy.ts
//
// /sso org precedence: URL `?organization=` first, then the session cookie entry's organization,
// then the shared default-org fallback (default-org-fallback.cy.ts covers that last rung).
//
// Why both rungs: the staff portal signs users in under its own Zitadel org (the OIDC org-id scope
// lands on the session entry), then sends them to a BARE /id/sso. Without the session rung the
// management screen listed the DEFAULT org's IdPs and the start-link action linked the wrong
// provider. Without the URL rung a caller could not point a user at a different org than the one
// their session was minted under. Node-bound: real signed `sessions` cookie + seeded fake provider.
import { callService } from '../../../support/node/call-service';

const RECORD = ['getActiveIdPs', 'startIdpIntent'] as const;
const USER = { id: 'u1', loginName: 'you@acme.test' };
const LIVE = [{ id: 'sess-1', token: 'tok-1', user: USER }];
const cookie = (organization?: string) => [
  { id: 'sess-1', token: 'tok-1', loginName: USER.loginName, organization },
];

describe('/sso org precedence — URL param, then session entry, then default org', () => {
  it('management loader: URL org wins over the session org, and is echoed for the forms', () => {
    callService({
      fn: 'resolveSsoManagement',
      provider: 'singleton',
      liveSessions: LIVE,
      request: {
        url: 'http://localhost/id/sso?organization=org-url',
        sessions: cookie('org-sess'),
      },
      recordCalls: [...RECORD],
    }).then((v) => {
      expect(v.calls?.getActiveIdPs?.[0]?.[0], 'IdPs listed for the URL org').to.equal('org-url');
      expect(v.outcome.kind).to.equal('data');
      expect(v.outcome.data.organization, 'echoed so the start-link forms carry it').to.equal(
        'org-url'
      );
    });
  });

  it('management loader: falls back to the session entry org on a bare /sso', () => {
    callService({
      fn: 'resolveSsoManagement',
      provider: 'singleton',
      liveSessions: LIVE,
      request: { url: 'http://localhost/id/sso', sessions: cookie('org-sess') },
      recordCalls: [...RECORD],
    }).then((v) => {
      expect(v.calls?.getActiveIdPs?.[0]?.[0], 'IdPs listed for the session org').to.equal(
        'org-sess'
      );
      expect(v.outcome.data.organization).to.equal('org-sess');
    });
  });

  it('start-link action: form org wins over the session org', () => {
    callService({
      fn: 'runSsoAction',
      provider: 'singleton',
      liveSessions: LIVE,
      request: {
        url: 'http://localhost/id/sso',
        sessions: cookie('org-sess'),
        form: { intent: 'start', provider: 'google', linkOnly: 'true', organization: 'org-form' },
      },
      recordCalls: [...RECORD],
    }).then((v) => {
      expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-form');
      const urls = v.calls?.startIdpIntent?.[0]?.[1] as { success: string };
      expect(urls.success, 'callback carries the form org').to.include('organization=org-form');
    });
  });

  it('start-link action: falls back to the session entry org when the form has none', () => {
    callService({
      fn: 'runSsoAction',
      provider: 'singleton',
      liveSessions: LIVE,
      request: {
        url: 'http://localhost/id/sso',
        sessions: cookie('org-sess'),
        form: { intent: 'start', provider: 'google', linkOnly: 'true' },
      },
      recordCalls: [...RECORD],
    }).then((v) => {
      expect(v.calls?.getActiveIdPs?.[0]?.[0]).to.equal('org-sess');
      const urls = v.calls?.startIdpIntent?.[0]?.[1] as { success: string };
      expect(urls.success, 'callback carries the session org').to.include('organization=org-sess');
    });
  });

  it('/sso/link with a session and no provider forwards ?organization= to /sso', () => {
    callService({
      fn: 'resolveSsoLink',
      provider: 'singleton',
      liveSessions: LIVE,
      request: {
        url: 'http://localhost/id/sso/link?organization=org-url',
        sessions: cookie(undefined),
      },
    }).then((v) => {
      expect(v.outcome.kind).to.equal('redirect');
      expect(v.outcome.location, 'org survives the hop to the management screen').to.equal(
        '/sso?organization=org-url'
      );
    });
  });
});
