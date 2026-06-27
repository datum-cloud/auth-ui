// cypress/component/modules/auth/session/last-used-login.cy.ts
//
// Node-bound (cy.task) port of app/modules/auth/session/__tests__/last-used-login.test.ts.
//
// last-used-login.ts is signed with SESSION_SECRET (via env.server, stubbed out of the browser
// bundle), so the REAL serialize→parse round-trip + /id path scoping run in Bun via cy.task.
import { callService } from '../../../../support/node/call-service';

describe('last-used-login cookie', () => {
  it('round-trips a token through serialize → parse', () => {
    callService({
      fn: 'lastUsedLoginCheck',
      lastUsedOp: 'roundTripIdp',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      expect((v.outcome as { parsed: string }).parsed).to.equal('idp:g');
    });
  });

  it('returns null when the cookie is absent', () => {
    callService({
      fn: 'lastUsedLoginCheck',
      lastUsedOp: 'absent',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      expect((v.outcome as { parsed: string | null }).parsed).to.be.null;
    });
  });

  it('round-trips email token', () => {
    callService({
      fn: 'lastUsedLoginCheck',
      lastUsedOp: 'roundTripEmail',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      expect((v.outcome as { parsed: string }).parsed).to.equal('email');
    });
  });

  it('round-trips passkey token', () => {
    callService({
      fn: 'lastUsedLoginCheck',
      lastUsedOp: 'roundTripPasskey',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      expect((v.outcome as { parsed: string }).parsed).to.equal('passkey');
    });
  });

  it('scopes the last-used-login cookie to /id', () => {
    callService({
      fn: 'lastUsedLoginCheck',
      lastUsedOp: 'scopedToId',
      request: { url: 'http://localhost/id' },
    }).then((v) => {
      const setCookie = (v.outcome as { setCookie: string }).setCookie;
      expect(setCookie).to.include('Path=/id');
      expect(setCookie).to.not.match(/Path=\/(;|$)/); // not the bare-root path
    });
  });
});
